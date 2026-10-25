// Copyright 2026 AI RV Harness contributors
// SPDX-License-Identifier: Apache-2.0 OR MIT

//! Owner-thread storage for Tao's non-Send event-loop target.
//!
//! Only the runtime holds a strong reference. Cross-thread dispatchers clone
//! atomic weak references, never Tao's internal Rc. Access checks the owner
//! thread BEFORE upgrade, so no worker can acquire a last strong reference and
//! run the target destructor after the runtime has been dropped.

use std::{
    fmt,
    marker::PhantomData,
    rc::Rc,
    sync::{Arc, Weak},
    thread::{self, ThreadId},
};

pub(crate) struct MainThreadTargetOwner<T> {
    value: Arc<T>,
    thread: ThreadId,
    // Enforce owner-thread destruction even when T happens to be Send + Sync.
    _not_send_or_sync: PhantomData<Rc<()>>,
}

impl<T> MainThreadTargetOwner<T> {
    pub(crate) fn new(value: T) -> Self {
        Self {
            value: Arc::new(value),
            thread: thread::current().id(),
            _not_send_or_sync: PhantomData,
        }
    }

    pub(crate) fn handle(&self) -> MainThreadTarget<T> {
        MainThreadTarget {
            value: Arc::downgrade(&self.value),
            thread: self.thread,
        }
    }
}

/// A cloneable dispatcher token, with no public strong reference or raw Weak.
/// `with` returns None off the owning thread or after runtime destruction.
pub struct MainThreadTarget<T> {
    value: Weak<T>,
    thread: ThreadId,
}

impl<T> Clone for MainThreadTarget<T> {
    fn clone(&self) -> Self {
        Self {
            value: self.value.clone(),
            thread: self.thread,
        }
    }
}

impl<T> fmt::Debug for MainThreadTarget<T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // Do not format T: Context/AppHandle Debug can be reached on a worker.
        f.debug_struct("MainThreadTarget")
            .field("owner", &self.thread)
            .finish_non_exhaustive()
    }
}

// SAFETY: cloning/dropping Weak only changes atomic allocation counters. The
// pointee is accessible solely inside `with`, after the owner-thread check.
// Strong references cannot escape that callback; final value destruction is
// confined to the !Send + !Sync owner. Debug never accesses the pointee.
unsafe impl<T> Send for MainThreadTarget<T> {}
unsafe impl<T> Sync for MainThreadTarget<T> {}

impl<T> MainThreadTarget<T> {
    pub fn with<R>(&self, f: impl FnOnce(&T) -> R) -> Option<R> {
        if thread::current().id() != self.thread {
            return None;
        }
        let value = self.value.upgrade()?;
        Some(f(&value))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Barrier, Mutex};

    struct ThreadAffine {
        _rc: Rc<()>,
        drops: Arc<Mutex<Vec<ThreadId>>>,
    }
    impl Drop for ThreadAffine {
        fn drop(&mut self) {
            self.drops.lock().unwrap().push(thread::current().id());
        }
    }
    impl fmt::Debug for ThreadAffine {
        fn fmt(&self, _: &mut fmt::Formatter<'_>) -> fmt::Result {
            panic!("pointee Debug must never run")
        }
    }
    fn owner() -> (
        MainThreadTargetOwner<ThreadAffine>,
        Arc<Mutex<Vec<ThreadId>>>,
    ) {
        let drops = Arc::new(Mutex::new(Vec::new()));
        (
            MainThreadTargetOwner::new(ThreadAffine {
                _rc: Rc::new(()),
                drops: drops.clone(),
            }),
            drops,
        )
    }

    #[test]
    fn owner_can_access_but_expired_handle_cannot() {
        let (owner, drops) = owner();
        let handle = owner.handle();
        assert_eq!(handle.with(|value| Rc::strong_count(&value._rc)), Some(1));
        drop(owner);
        assert!(handle.with(|_| panic!("expired callback")).is_none());
        assert_eq!(*drops.lock().unwrap(), vec![thread::current().id()]);
    }

    #[test]
    fn workers_clone_drop_and_debug_without_accessing_or_destroying_the_target() {
        let (owner, drops) = owner();
        let start = Arc::new(Barrier::new(9));
        let workers: Vec<_> = (0..8)
            .map(|_| {
                let handle = owner.handle();
                let start = start.clone();
                thread::spawn(move || {
                    start.wait();
                    assert!(format!("{handle:?}").contains("MainThreadTarget"));
                    for _ in 0..100_000 {
                        let clone = handle.clone();
                        assert!(clone
                            .with(|_| panic!("worker accessed Tao target"))
                            .is_none());
                        std::hint::black_box(clone);
                    }
                })
            })
            .collect();
        start.wait();
        for worker in workers {
            worker.join().unwrap();
        }
        assert!(drops.lock().unwrap().is_empty());
        drop(owner);
        assert_eq!(*drops.lock().unwrap(), vec![thread::current().id()]);
    }

    #[test]
    fn owner_teardown_while_worker_tokens_survive_destroys_value_once_on_owner() {
        let owner_thread = thread::current().id();
        let (owner, drops) = owner();
        let start = Arc::new(Barrier::new(9));
        let workers: Vec<_> = (0..8)
            .map(|_| {
                let handle = owner.handle();
                let start = start.clone();
                thread::spawn(move || {
                    start.wait();
                    for _ in 0..100_000 {
                        let clone = handle.clone();
                        assert!(clone
                            .with(|_| panic!("worker upgraded a shutdown target"))
                            .is_none());
                        drop(clone);
                    }
                })
            })
            .collect();
        start.wait();
        drop(owner);
        for worker in workers {
            worker.join().unwrap();
        }
        assert_eq!(*drops.lock().unwrap(), vec![owner_thread]);
    }
}
