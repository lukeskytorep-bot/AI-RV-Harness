//! Windows-only native Context/AppHandle-equivalent clone/drop stress.
//! No WebView, database, credentials or provider requests are created.
fn stress<R: tauri::Runtime>() {
    use std::sync::{Arc, Barrier};
    let runtime = R::new(Default::default()).expect("initialize owner-thread runtime");
    let start = Arc::new(Barrier::new(9));
    let workers: Vec<_> = (0..8)
        .map(|_| {
            let handle = runtime.handle();
            let start = start.clone();
            std::thread::spawn(move || {
                start.wait();
                for _ in 0..100_000 {
                    std::hint::black_box(handle.clone());
                }
            })
        })
        .collect();
    println!("START: 8 workers x 100000 runtime-handle clone/drop pairs");
    start.wait();
    let early_drop = std::env::args().any(|arg| arg == "--drop-before-join");
    let mut owner = Some(runtime);
    if early_drop {
        drop(owner.take());
        println!("OWNER DROPPED before worker joins");
    }
    for worker in workers {
        worker.join().expect("clone worker");
    }
    println!("JOINED workers");
    drop(owner);
    println!("PASS: native runtime-handle stress; early_drop={early_drop}");
}
#[cfg(windows)]
fn main() {
    stress::<tauri::Wry>();
}
#[cfg(not(windows))]
fn main() {
    let _ = stress::<tauri::Wry> as fn(); // Type-check this path on Linux without creating a GUI.
    eprintln!("Windows-only runtime stress; not a platform acceptance on this host.");
}
