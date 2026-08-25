use std::{
    fs,
    io::{Cursor, Read},
    path::{Path, PathBuf},
    time::Duration,
};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use lopdf::Document;
use serde::Serialize;
use sha2::{Digest, Sha256};
use zip::ZipArchive;

use crate::dialogs;

const MAX_DOCUMENT_BYTES: usize = 15 * 1024 * 1024;
const MAX_TEXT_BYTES: usize = 2 * 1024 * 1024;
const MAX_DOCX_ENTRIES: usize = 512;
const MAX_DOCX_UNCOMPRESSED_BYTES: u64 = 50 * 1024 * 1024;
const MAX_DOCX_XML_BYTES: u64 = 8 * 1024 * 1024;
const MAX_DOCX_COMPRESSION_RATIO: u64 = 120;
const MAX_XML_NODES: usize = 250_000;
const MAX_XML_DEPTH: usize = 128;
const MAX_PDF_PAGES: usize = 200;
const MAX_IMAGE_BYTES: usize = 10 * 1024 * 1024;
const MAX_IMAGE_DIMENSION: u32 = 16_384;
const MAX_IMAGE_PIXELS: u64 = 40_000_000;
const IMPORT_TIMEOUT: Duration = Duration::from_secs(30);

const ENGLISH_LEXICON: &[u8] = include_bytes!("../resources/documents/AI Field Perception Lexicon.docx");
const POLISH_LEXICON: &[u8] = include_bytes!("../resources/documents/Słownik Percepcyjny Pola dla AI.docx");
const ENGLISH_TELEPATHY: &[u8] = include_bytes!("../resources/documents/TELEPATHY MODULE – PROTOCOL FOR AI VIEWER v1.1.docx");
const POLISH_TELEPATHY: &[u8] = include_bytes!("../resources/documents/MODUŁ TELEPATIA – PROTOKÓŁ DLA AI VIEWERA 1.1 .docx");

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedDocumentSource {
    display_name: String,
    source_type: String,
    content: String,
    content_hash: String,
    mime_type: String,
    import_method: String,
    size_bytes: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedImageSource {
    display_name: String,
    mime_type: String,
    data_base64: String,
    sha256: String,
    size_bytes: usize,
    width: u32,
    height: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ParsedAttachment {
    Document(ParsedDocumentSource),
    Image(ParsedImageSource),
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuiltinDocumentManifest {
    id: String,
    file_name: String,
    language: String,
    title: String,
    description: String,
    sha256: String,
    size_bytes: usize,
}

struct BuiltinDocument {
    id: &'static str,
    file_name: &'static str,
    language: &'static str,
    title: &'static str,
    description: &'static str,
    bytes: &'static [u8],
}

fn builtin_documents() -> [BuiltinDocument; 4] {
    [
        BuiltinDocument {
            id: "field-lexicon-en",
            file_name: "AI Field Perception Lexicon.docx",
            language: "en",
            title: "AI Field Perception Lexicon",
            description: "Original English field-perception reference document.",
            bytes: ENGLISH_LEXICON,
        },
        BuiltinDocument {
            id: "field-lexicon-pl",
            file_name: "Słownik Percepcyjny Pola dla AI.docx",
            language: "pl",
            title: "Słownik Percepcyjny Pola dla AI",
            description: "Oryginalny polski słownik percepcji pola.",
            bytes: POLISH_LEXICON,
        },
        BuiltinDocument {
            id: "telepathy-module-en",
            file_name: "TELEPATHY MODULE – PROTOCOL FOR AI VIEWER v1.1.docx",
            language: "en",
            title: "Telepathy Module – Protocol for AI Viewer v1.1",
            description: "Original English Telepathy Module document.",
            bytes: ENGLISH_TELEPATHY,
        },
        BuiltinDocument {
            id: "telepathy-module-pl",
            file_name: "MODUŁ TELEPATIA – PROTOKÓŁ DLA AI VIEWERA 1.1 .docx",
            language: "pl",
            title: "Moduł Telepatia – Protokół dla AI Viewera 1.1",
            description: "Oryginalny polski dokument Modułu Telepatia.",
            bytes: POLISH_TELEPATHY,
        },
    ]
}

fn builtin_document(id: &str) -> Result<BuiltinDocument, String> {
    builtin_documents()
        .into_iter()
        .find(|item| item.id == id)
        .ok_or_else(|| "unknown built-in document".to_string())
}

#[tauri::command]
pub fn list_builtin_documents() -> Vec<BuiltinDocumentManifest> {
    builtin_documents()
        .into_iter()
        .map(|document| BuiltinDocumentManifest {
            id: document.id.to_string(),
            file_name: document.file_name.to_string(),
            language: document.language.to_string(),
            title: document.title.to_string(),
            description: document.description.to_string(),
            sha256: sha256(document.bytes),
            size_bytes: document.bytes.len(),
        })
        .collect()
}

#[tauri::command]
pub async fn read_builtin_document(id: String) -> Result<ParsedDocumentSource, String> {
    let document = builtin_document(&id)?;
    let file_name = document.file_name.to_string();
    let bytes = document.bytes.to_vec();
    parse_document_with_timeout(file_name, bytes).await
}

#[tauri::command]
pub async fn save_builtin_document(
    app: tauri::AppHandle,
    id: String,
    title: String,
) -> Result<Option<String>, String> {
    let document = builtin_document(&id)?;
    let Some(path) = dialogs::choose_document_save_path(
        app,
        title,
        document.file_name.to_string(),
    )
    .await?
    else {
        return Ok(None);
    };
    validate_save_path(&path)?;
    fs::write(&path, document.bytes).map_err(|error| format!("could not save document: {error}"))?;
    let saved = fs::read(&path).map_err(|error| format!("could not verify saved document: {error}"))?;
    if sha256(&saved) != sha256(document.bytes) {
        return Err("saved document failed the SHA-256 verification".to_string());
    }
    Ok(Some(path.to_string_lossy().to_string()))
}

#[tauri::command]
pub async fn import_attachment(path: String) -> Result<ParsedAttachment, String> {
    let path = fs::canonicalize(PathBuf::from(path))
        .map_err(|_| "selected attachment does not exist".to_string())?;
    if !path.is_file() {
        return Err("selected attachment is not a file".to_string());
    }
    let file_name = safe_file_name(&path)?;
    let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;
    if metadata.len() == 0 {
        return Err("selected attachment is empty".to_string());
    }
    if metadata.len() > MAX_DOCUMENT_BYTES as u64 {
        return Err("selected attachment exceeds the 15 MB import limit".to_string());
    }
    let bytes = fs::read(&path).map_err(|error| error.to_string())?;
    if is_image_extension(&file_name) {
        return parse_image(file_name, bytes).map(ParsedAttachment::Image);
    }
    parse_document_with_timeout(file_name, bytes)
        .await
        .map(ParsedAttachment::Document)
}

async fn parse_document_with_timeout(
    file_name: String,
    bytes: Vec<u8>,
) -> Result<ParsedDocumentSource, String> {
    let task = tauri::async_runtime::spawn_blocking(move || parse_document(&file_name, &bytes));
    match tokio::time::timeout(IMPORT_TIMEOUT, task).await {
        Ok(result) => result.map_err(|error| error.to_string())?,
        Err(_) => Err("document import exceeded the 30 second safety limit".to_string()),
    }
}

fn parse_document(file_name: &str, bytes: &[u8]) -> Result<ParsedDocumentSource, String> {
    if bytes.is_empty() || bytes.len() > MAX_DOCUMENT_BYTES {
        return Err("document must be between 1 byte and 15 MB".to_string());
    }
    let lower = file_name.to_lowercase();
    let (source_type, mime_type, import_method, content) = if bytes.starts_with(b"%PDF-") {
        if !lower.ends_with(".pdf") {
            return Err("file content is PDF but the extension does not match".to_string());
        }
        ("pdf", "application/pdf", "lopdf-text", parse_pdf(bytes)?)
    } else if bytes.starts_with(b"PK\x03\x04") || bytes.starts_with(b"PK\x05\x06") {
        if !lower.ends_with(".docx") {
            return Err("file content is a ZIP package but the extension is not .docx".to_string());
        }
        (
            "docx",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "safe-docx-xml",
            parse_docx(bytes)?,
        )
    } else if lower.ends_with(".txt") || lower.ends_with(".md") {
        let text = String::from_utf8(bytes.to_vec())
            .map_err(|_| "text source must use UTF-8 encoding".to_string())?
            .trim_start_matches('\u{feff}')
            .to_string();
        let source_type = if lower.ends_with(".md") { "markdown" } else { "text" };
        let mime = if source_type == "markdown" { "text/markdown" } else { "text/plain" };
        (source_type, mime, "utf8-text", text)
    } else {
        return Err("unsupported attachment content; choose TXT, MD, text PDF, DOCX, PNG, JPEG, WebP or GIF".to_string());
    };
    let content = normalize_extracted_text(content)?;
    Ok(ParsedDocumentSource {
        display_name: file_name.to_string(),
        source_type: source_type.to_string(),
        content_hash: sha256(content.as_bytes()),
        content,
        mime_type: mime_type.to_string(),
        import_method: import_method.to_string(),
        size_bytes: bytes.len(),
    })
}

fn parse_docx(bytes: &[u8]) -> Result<String, String> {
    let mut archive = ZipArchive::new(Cursor::new(bytes))
        .map_err(|_| "DOCX package is damaged or password-protected".to_string())?;
    if archive.len() == 0 || archive.len() > MAX_DOCX_ENTRIES {
        return Err("DOCX contains too many package entries".to_string());
    }
    let mut total_uncompressed = 0u64;
    let mut document_index = None;
    for index in 0..archive.len() {
        let entry = archive.by_index(index).map_err(|_| "DOCX package entry is damaged".to_string())?;
        let name = entry.name().replace('\\', "/");
        if entry.enclosed_name().is_none() || name.starts_with('/') || name.contains("../") {
            return Err("DOCX contains an unsafe package path".to_string());
        }
        let lower = name.to_ascii_lowercase();
        if lower.contains("vbaproject")
            || lower.starts_with("word/embeddings/")
            || lower.starts_with("word/externallinks/")
            || lower.ends_with(".bin")
        {
            return Err("DOCX contains macros, embedded objects or active external content".to_string());
        }
        total_uncompressed = total_uncompressed.saturating_add(entry.size());
        if total_uncompressed > MAX_DOCX_UNCOMPRESSED_BYTES {
            return Err("DOCX exceeds the uncompressed-size limit".to_string());
        }
        let compressed = entry.compressed_size().max(1);
        if entry.size() > 1_048_576 && entry.size() / compressed > MAX_DOCX_COMPRESSION_RATIO {
            return Err("DOCX has an unsafe compression ratio".to_string());
        }
        if lower == "word/document.xml" {
            document_index = Some(index);
            if entry.size() > MAX_DOCX_XML_BYTES {
                return Err("DOCX document XML exceeds the safety limit".to_string());
            }
        }
    }
    let index = document_index.ok_or_else(|| "DOCX is missing word/document.xml".to_string())?;
    let entry = archive.by_index(index).map_err(|_| "DOCX document XML is unavailable".to_string())?;
    if entry.encrypted() {
        return Err("password-protected DOCX files are not supported".to_string());
    }
    let mut xml = String::new();
    entry
        .take(MAX_DOCX_XML_BYTES + 1)
        .read_to_string(&mut xml)
        .map_err(|_| "DOCX document XML is not valid UTF-8".to_string())?;
    if xml.len() as u64 > MAX_DOCX_XML_BYTES {
        return Err("DOCX document XML exceeds the safety limit".to_string());
    }
    if xml.contains("<!DOCTYPE") || xml.contains("<!ENTITY") {
        return Err("DOCX DTD and entity declarations are not allowed".to_string());
    }
    let document = roxmltree::Document::parse(&xml).map_err(|_| "DOCX contains malformed XML".to_string())?;
    let mut node_count = 0usize;
    let mut output = String::new();
    for paragraph in document.descendants().filter(|node| node.is_element() && node.tag_name().name() == "p") {
        let mut paragraph_text = String::new();
        for node in paragraph.descendants() {
            node_count += 1;
            if node_count > MAX_XML_NODES || node.ancestors().take(MAX_XML_DEPTH + 1).count() > MAX_XML_DEPTH {
                return Err("DOCX XML complexity exceeds the safety limit".to_string());
            }
            if node.is_element() && node.tag_name().name() == "t" {
                if let Some(text) = node.text() {
                    paragraph_text.push_str(text);
                }
            } else if node.is_element() && node.tag_name().name() == "tab" {
                paragraph_text.push('\t');
            } else if node.is_element() && matches!(node.tag_name().name(), "br" | "cr") {
                paragraph_text.push('\n');
            }
        }
        if !paragraph_text.trim().is_empty() {
            output.push_str(paragraph_text.trim_end());
            output.push('\n');
        }
        if output.len() > MAX_TEXT_BYTES {
            return Err("DOCX extracted text exceeds the 2 MB limit".to_string());
        }
    }
    Ok(output)
}

fn parse_pdf(bytes: &[u8]) -> Result<String, String> {
    let document = Document::load_mem(bytes).map_err(|_| "PDF is damaged, encrypted or unsupported".to_string())?;
    if document.is_encrypted() {
        return Err("password-protected or encrypted PDF files are not supported".to_string());
    }
    let pages = document.get_pages();
    if pages.is_empty() {
        return Err("PDF contains no pages".to_string());
    }
    if pages.len() > MAX_PDF_PAGES {
        return Err("PDF exceeds the 200-page safety limit".to_string());
    }
    let page_numbers = pages.keys().copied().collect::<Vec<_>>();
    let text = document.extract_text(&page_numbers).map_err(|_| "PDF text extraction failed".to_string())?;
    if text.trim().is_empty() {
        return Err("PDF has no text layer; OCR is not supported yet".to_string());
    }
    if text.len() > MAX_TEXT_BYTES {
        return Err("PDF extracted text exceeds the 2 MB limit".to_string());
    }
    Ok(text)
}

fn normalize_extracted_text(content: String) -> Result<String, String> {
    let content = content.replace("\r\n", "\n").replace('\r', "\n");
    let content = content.trim().to_string();
    if content.is_empty() {
        return Err("document contains no readable text".to_string());
    }
    if content.len() > MAX_TEXT_BYTES {
        return Err("extracted text exceeds the 2 MB limit".to_string());
    }
    Ok(content)
}

fn parse_image(file_name: String, bytes: Vec<u8>) -> Result<ParsedImageSource, String> {
    let (mime_type, width, height) = validate_image_bytes(&file_name, &bytes)?;
    Ok(ParsedImageSource {
        display_name: file_name,
        mime_type: mime_type.to_string(),
        sha256: sha256(&bytes),
        size_bytes: bytes.len(),
        width,
        height,
        data_base64: BASE64.encode(bytes),
    })
}

pub(crate) fn validate_image_bytes(file_name: &str, bytes: &[u8]) -> Result<(&'static str, u32, u32), String> {
    if bytes.is_empty() || bytes.len() > MAX_IMAGE_BYTES {
        return Err("chat image must be between 1 byte and 10 MB".to_string());
    }
    let (mime_type, width, height) = image_metadata(&bytes)
        .ok_or_else(|| "image is damaged or its byte signature is unsupported".to_string())?;
    if !extension_matches_image(&file_name, mime_type) {
        return Err("image extension does not match its byte signature".to_string());
    }
    if width == 0
        || height == 0
        || width > MAX_IMAGE_DIMENSION
        || height > MAX_IMAGE_DIMENSION
        || u64::from(width) * u64::from(height) > MAX_IMAGE_PIXELS
    {
        return Err("image dimensions exceed the safety limit".to_string());
    }
    let decoded = image::load_from_memory(bytes)
        .map_err(|_| "image data cannot be decoded safely".to_string())?;
    if decoded.width() != width || decoded.height() != height {
        return Err("decoded image dimensions do not match the file header".to_string());
    }
    Ok((mime_type, width, height))
}

fn image_metadata(bytes: &[u8]) -> Option<(&'static str, u32, u32)> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") && bytes.len() >= 24 && &bytes[12..16] == b"IHDR" {
        return Some((
            "image/png",
            u32::from_be_bytes(bytes[16..20].try_into().ok()?),
            u32::from_be_bytes(bytes[20..24].try_into().ok()?),
        ));
    }
    if (bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a")) && bytes.len() >= 10 {
        return Some((
            "image/gif",
            u16::from_le_bytes(bytes[6..8].try_into().ok()?) as u32,
            u16::from_le_bytes(bytes[8..10].try_into().ok()?) as u32,
        ));
    }
    if bytes.starts_with(b"\xff\xd8") {
        return jpeg_dimensions(bytes).map(|(width, height)| ("image/jpeg", width, height));
    }
    if bytes.len() >= 30 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        return webp_dimensions(bytes).map(|(width, height)| ("image/webp", width, height));
    }
    None
}

fn jpeg_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    let mut index = 2usize;
    while index + 9 < bytes.len() {
        if bytes[index] != 0xff {
            index += 1;
            continue;
        }
        let marker = bytes[index + 1];
        index += 2;
        if matches!(marker, 0xd8 | 0xd9) {
            continue;
        }
        if index + 2 > bytes.len() {
            return None;
        }
        let length = u16::from_be_bytes(bytes[index..index + 2].try_into().ok()?) as usize;
        if length < 2 || index + length > bytes.len() {
            return None;
        }
        if matches!(marker, 0xc0 | 0xc1 | 0xc2 | 0xc3 | 0xc5 | 0xc6 | 0xc7 | 0xc9 | 0xca | 0xcb | 0xcd | 0xce | 0xcf) {
            let height = u16::from_be_bytes(bytes[index + 3..index + 5].try_into().ok()?) as u32;
            let width = u16::from_be_bytes(bytes[index + 5..index + 7].try_into().ok()?) as u32;
            return Some((width, height));
        }
        index += length;
    }
    None
}

fn webp_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    match &bytes[12..16] {
        b"VP8X" if bytes.len() >= 30 => {
            let width = 1 + u32::from_le_bytes([bytes[24], bytes[25], bytes[26], 0]);
            let height = 1 + u32::from_le_bytes([bytes[27], bytes[28], bytes[29], 0]);
            Some((width, height))
        }
        b"VP8L" if bytes.len() >= 25 && bytes[20] == 0x2f => {
            let bits = u32::from_le_bytes(bytes[21..25].try_into().ok()?);
            Some(((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1))
        }
        b"VP8 " if bytes.len() >= 30 && &bytes[23..26] == b"\x9d\x01\x2a" => Some((
            u16::from_le_bytes(bytes[26..28].try_into().ok()?) as u32 & 0x3fff,
            u16::from_le_bytes(bytes[28..30].try_into().ok()?) as u32 & 0x3fff,
        )),
        _ => None,
    }
}

fn is_image_extension(file_name: &str) -> bool {
    let lower = file_name.to_ascii_lowercase();
    [".png", ".jpg", ".jpeg", ".webp", ".gif"]
        .iter()
        .any(|extension| lower.ends_with(extension))
}

fn extension_matches_image(file_name: &str, mime_type: &str) -> bool {
    let lower = file_name.to_ascii_lowercase();
    match mime_type {
        "image/png" => lower.ends_with(".png"),
        "image/jpeg" => lower.ends_with(".jpg") || lower.ends_with(".jpeg"),
        "image/webp" => lower.ends_with(".webp"),
        "image/gif" => lower.ends_with(".gif"),
        _ => false,
    }
}

fn validate_save_path(path: &Path) -> Result<(), String> {
    if !path.is_absolute() || path.parent().is_none() {
        return Err("save destination must be an absolute file path".to_string());
    }
    if !path
        .file_name()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.to_ascii_lowercase().ends_with(".docx"))
    {
        return Err("built-in documents must be saved with the .docx extension".to_string());
    }
    Ok(())
}

fn safe_file_name(path: &Path) -> Result<String, String> {
    path.file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .map(|value| value.chars().take(240).collect())
        .ok_or_else(|| "selected attachment has an invalid file name".to_string())
}

fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_png_dimensions_from_bytes() {
        let mut bytes = b"\x89PNG\r\n\x1a\n".to_vec();
        bytes.extend_from_slice(&[0, 0, 0, 13]);
        bytes.extend_from_slice(b"IHDR");
        bytes.extend_from_slice(&320u32.to_be_bytes());
        bytes.extend_from_slice(&240u32.to_be_bytes());
        assert_eq!(image_metadata(&bytes), Some(("image/png", 320, 240)));
    }

    #[test]
    fn rejects_extension_spoofing_for_images() {
        assert!(!extension_matches_image("fake.jpg", "image/png"));
        assert!(extension_matches_image("photo.jpeg", "image/jpeg"));
    }

    #[test]
    fn rejects_truncated_images_even_when_the_header_has_dimensions() {
        let mut bytes = b"\x89PNG\r\n\x1a\n".to_vec();
        bytes.extend_from_slice(&[0, 0, 0, 13]);
        bytes.extend_from_slice(b"IHDR");
        bytes.extend_from_slice(&320u32.to_be_bytes());
        bytes.extend_from_slice(&240u32.to_be_bytes());
        assert!(validate_image_bytes("broken.png", &bytes).is_err());
    }

    #[test]
    fn parses_plain_utf8_text_only_when_extension_matches() {
        assert!(parse_document("notes.txt", b"hello").is_ok());
        assert!(parse_document("notes.pdf", b"hello").is_err());
    }

    #[test]
    fn built_in_manifest_hashes_exact_bytes() {
        let manifest = list_builtin_documents();
        assert_eq!(manifest.len(), 4);
        assert_eq!(manifest[0].sha256, sha256(ENGLISH_LEXICON));
        assert_eq!(manifest[3].file_name, "MODUŁ TELEPATIA – PROTOKÓŁ DLA AI VIEWERA 1.1 .docx");
    }
}
