use std::{collections::{HashMap, HashSet}, future::Future, sync::{LazyLock, Mutex}, time::{Duration, SystemTime, UNIX_EPOCH}};

use futures_util::future::{AbortHandle, Abortable};
use reqwest::{Client, RequestBuilder};
use serde_json::Value;

use super::ProviderCallError;
use super::errors::{provider_error_metadata, request_error, safe_provider_error};
use super::validation::validate_request_id;

#[derive(Default)]
struct ChatCancellationRegistry {
    active: HashMap<String, AbortHandle>,
    cancelled_before_start: HashSet<String>,
}

static CHAT_CANCELLATIONS: LazyLock<Mutex<ChatCancellationRegistry>> =
    LazyLock::new(|| Mutex::new(ChatCancellationRegistry::default()));

static HTTP_CLIENT: LazyLock<Result<Client, String>> = LazyLock::new(|| {
    Client::builder()
        .connect_timeout(Duration::from_secs(30))
        .user_agent(format!("AI-RV-Harness/{}", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| error.to_string())
});

pub(super) fn client() -> Result<&'static Client, String> {
    HTTP_CLIENT.as_ref().map_err(Clone::clone)
}

const MAX_RETRY_AFTER_MS: u64 = 30_000;

pub(super) fn retry_after_ms(headers: &reqwest::header::HeaderMap) -> Option<u64> {
    let value = headers.get(reqwest::header::RETRY_AFTER)?.to_str().ok()?.trim();
    retry_after_value_ms_at(value, SystemTime::now())
}

pub(super) fn retry_after_value_ms_at(value: &str, now: SystemTime) -> Option<u64> {
    let value = value.trim();
    if let Ok(seconds) = value.parse::<u64>() {
        return Some(seconds.saturating_mul(1_000).min(MAX_RETRY_AFTER_MS));
    }
    let target = parse_http_date(value)?;
    let delay = match target.duration_since(now) {
        Ok(duration) => duration.as_millis().min(u128::from(u64::MAX)) as u64,
        Err(_) => 0,
    };
    Some(delay.min(MAX_RETRY_AFTER_MS))
}

fn parse_http_date(value: &str) -> Option<SystemTime> {
    // Retry-After only needs the current HTTP-date wire format here. Legacy
    // RFC 850/asctime forms deliberately fall back to the normal jitter/backoff
    // instead of maintaining a second date-parser implementation in transport.
    parse_imf_fixdate(value)
}

fn parse_imf_fixdate(value: &str) -> Option<SystemTime> {
    let parts = value.split_whitespace().collect::<Vec<_>>();
    if parts.len() != 6
        || parts[0].len() != 4
        || !parts[0].ends_with(',')
        || parts[1].len() != 2
        || parts[2].len() != 3
        || parts[3].len() != 4
        || parts[4].len() != 8
        || parts[4].as_bytes().get(2) != Some(&b':')
        || parts[4].as_bytes().get(5) != Some(&b':')
        || !parts[5].eq_ignore_ascii_case("GMT")
    {
        return None;
    }
    system_time_from_http_parts(
        parts[3].parse().ok()?,
        month_number(parts[2])?,
        parts[1].parse().ok()?,
        parts[4],
    )
}

fn system_time_from_http_parts(year: i32, month: u32, day: u32, time: &str) -> Option<SystemTime> {
    let hms = time.split(':').collect::<Vec<_>>();
    if hms.len() != 3 {
        return None;
    }
    let hour = hms[0].parse::<u32>().ok()?;
    let minute = hms[1].parse::<u32>().ok()?;
    let second = hms[2].parse::<u32>().ok()?;
    if !(1..=12).contains(&month)
        || day == 0
        || day > days_in_month(year, month)
        || hour > 23
        || minute > 59
        || second > 60
    {
        return None;
    }
    let days = days_from_civil(year, month, day);
    let seconds = days
        .checked_mul(86_400)?
        .checked_add(i64::from(hour) * 3_600)?
        .checked_add(i64::from(minute) * 60)?
        .checked_add(i64::from(second))?;
    if seconds >= 0 {
        UNIX_EPOCH.checked_add(Duration::from_secs(seconds as u64))
    } else {
        UNIX_EPOCH.checked_sub(Duration::from_secs(seconds.unsigned_abs()))
    }
}

fn month_number(value: &str) -> Option<u32> {
    match value.to_ascii_lowercase().as_str() {
        "jan" => Some(1),
        "feb" => Some(2),
        "mar" => Some(3),
        "apr" => Some(4),
        "may" => Some(5),
        "jun" => Some(6),
        "jul" => Some(7),
        "aug" => Some(8),
        "sep" => Some(9),
        "oct" => Some(10),
        "nov" => Some(11),
        "dec" => Some(12),
        _ => None,
    }
}

fn days_in_month(year: i32, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if is_leap_year(year) => 29,
        2 => 28,
        _ => 0,
    }
}

fn is_leap_year(year: i32) -> bool {
    year % 4 == 0 && (year % 100 != 0 || year % 400 == 0)
}

// Howard Hinnant's civil-date conversion, returning days relative to 1970-01-01.
fn days_from_civil(year: i32, month: u32, day: u32) -> i64 {
    let adjusted_year = year - if month <= 2 { 1 } else { 0 };
    let era = if adjusted_year >= 0 { adjusted_year } else { adjusted_year - 399 } / 400;
    let year_of_era = adjusted_year - era * 400;
    let shifted_month = i64::from(month) + if month > 2 { -3 } else { 9 };
    let day_of_year = (153 * shifted_month + 2) / 5 + i64::from(day) - 1;
    let day_of_era = i64::from(year_of_era) * 365
        + i64::from(year_of_era / 4)
        - i64::from(year_of_era / 100)
        + day_of_year;
    i64::from(era) * 146_097 + day_of_era - 719_468
}

pub(super) async fn json_response(response: reqwest::Response, secret: &str) -> Result<(Value, Option<String>), String> {
    let status = response.status();
    let retry_after_ms = retry_after_ms(response.headers());
    let request_id = response
        .headers()
        .get("x-request-id")
        .or_else(|| response.headers().get("request-id"))
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let body = response.text().await.map_err(|error| format!("provider response body read failed: {error}"))?;
    if !status.is_success() {
        return Err(safe_provider_error(status, &body, secret, retry_after_ms));
    }
    let value = serde_json::from_str(&body).map_err(|_| "provider returned invalid JSON".to_string())?;
    Ok((value, request_id))
}

async fn chat_json_response(response: reqwest::Response, secret: &str) -> Result<(Value, Option<String>), ProviderCallError> {
    let status = response.status();
    let retry_after_ms = retry_after_ms(response.headers());
    let request_id = response
        .headers()
        .get("x-request-id")
        .or_else(|| response.headers().get("request-id"))
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let body = response.text().await.map_err(|error| {
        let mut failure = request_error(error, "reading_body");
        failure.provider_request_id = request_id.clone().map(String::into_boxed_str);
        failure
    })?;
    if !status.is_success() {
        let parsed = serde_json::from_str::<Value>(&body).ok();
        let (provider_error_type, provider_code) = parsed.as_ref().map(provider_error_metadata).unwrap_or_default();
        let mut failure = ProviderCallError::new(
            "http_status",
            safe_provider_error(status, &body, secret, retry_after_ms),
            "reading_body",
        );
        failure.http_status = Some(status.as_u16());
        failure.provider_error_type = provider_error_type;
        failure.provider_code = provider_code;
        failure.retry_after_ms = retry_after_ms;
        failure.provider_request_id = request_id.map(String::into_boxed_str);
        return Err(failure);
    }
    let value = serde_json::from_str(&body).map_err(|error| {
        let mut failure = ProviderCallError::new(
            "invalid_provider_json",
            format!("provider returned invalid JSON: {error}"),
            "parsing_body",
        );
        failure.provider_request_id = request_id.clone().map(String::into_boxed_str);
        failure
    })?;
    Ok((value, request_id))
}

pub(super) async fn run_cancellable_chat_request<T, F>(
    request_id: Option<&str>,
    cancellation_phase: &'static str,
    request: F,
) -> Result<T, ProviderCallError>
where
    F: Future<Output = Result<T, ProviderCallError>>,
{
    let Some(request_id) = request_id else {
        return request.await;
    };
    validate_request_id(request_id).map_err(ProviderCallError::configuration)?;
    let (handle, registration) = AbortHandle::new_pair();
    {
        let mut registry = CHAT_CANCELLATIONS
            .lock()
            .map_err(|_| ProviderCallError::configuration("provider cancellation registry is unavailable"))?;
        if registry.cancelled_before_start.remove(request_id) {
            return Err(ProviderCallError::new("cancelled", "provider request cancelled", "before_dispatch"));
        }
        if registry.active.insert(request_id.to_string(), handle).is_some() {
            return Err(ProviderCallError::configuration("duplicate provider request id"));
        }
    }
    let result = Abortable::new(request, registration).await;
    CHAT_CANCELLATIONS
        .lock()
        .map_err(|_| ProviderCallError::configuration("provider cancellation registry is unavailable"))?
        .active
        .remove(request_id);
    match result {
        Ok(response) => response,
        Err(_) => Err(ProviderCallError::new("cancelled", "provider request cancelled", cancellation_phase)),
    }
}

pub(super) async fn send_chat_request(builder: RequestBuilder, request_id: Option<&str>, secret: &str) -> Result<(Value, Option<String>), ProviderCallError> {
    run_cancellable_chat_request(request_id, "awaiting_headers", async {
        let response = builder.send().await.map_err(|error| request_error(error, "awaiting_headers"))?;
        chat_json_response(response, secret).await
    }).await
}

pub(super) fn cancel_request(request_id: String) -> Result<bool, String> {
    validate_request_id(&request_id)?;
    let mut registry = CHAT_CANCELLATIONS
        .lock()
        .map_err(|_| "provider cancellation registry is unavailable".to_string())?;
    let handle = registry.active.remove(&request_id);
    if let Some(handle) = handle {
        handle.abort();
        Ok(true)
    } else {
        if registry.cancelled_before_start.len() >= 1024 {
            registry.cancelled_before_start.clear();
        }
        registry.cancelled_before_start.insert(request_id);
        Ok(false)
    }
}
