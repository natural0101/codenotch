//! Optional local catalogue and Markdown reader. No credentials, remote requests or Context MCP.
use serde::{Deserialize, Serialize};
use std::fs::{self, File, Metadata, OpenOptions};
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;

const MAX_DOCUMENTS: usize = 1000;
const MAX_DEPTH: usize = 8;
const MAX_BYTES: u64 = 256 * 1024;
const MAX_ENTRIES: usize = 20_000;
static WRITE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Service {
    pub id: String,
    pub name: String,
    pub url: String,
    pub description: String,
}

#[derive(Default, Serialize, Deserialize)]
#[serde(default)]
struct ModuleConfig {
    services: Vec<Service>,
    memory_root: Option<PathBuf>,
    next_service_id: u64,
    focus: String,
}

#[derive(Debug, Serialize)]
pub struct MemoryDocument {
    pub id: String,
    pub title: String,
    /// Unix milliseconds; 0 when unavailable.
    pub modified: u64,
}

#[derive(Debug, Serialize)]
pub struct MemoryIndex {
    pub available: bool,
    pub root: Option<String>,
    pub documents: Vec<MemoryDocument>,
    pub truncated: bool,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct MemoryText {
    pub id: String,
    pub title: String,
    pub text: String,
    pub modified: u64,
}

fn config_path() -> PathBuf {
    crate::config::config_path().with_file_name("local-modules.json")
}

fn load() -> Result<ModuleConfig, String> {
    let bytes = match fs::read(config_path()) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(ModuleConfig::default()),
        Err(e) => return Err(format!("Cannot read local module settings: {e}")),
    };
    serde_json::from_slice(&bytes).map_err(|e| format!("Invalid local module settings: {e}"))
}

fn save(config: &ModuleConfig) -> Result<(), String> {
    let path = config_path();
    if let Some(parent) = path.parent() { fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
    let text = serde_json::to_vec_pretty(config).map_err(|e| e.to_string())?;
    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, text).map_err(|e| e.to_string())?;
    fs::rename(&temporary, path).map_err(|e| format!("Cannot save local module settings: {e}"))
}

pub fn get_services() -> Result<Vec<Service>, String> { Ok(load()?.services) }

pub fn get_focus() -> Result<String, String> { Ok(load()?.focus) }

pub fn set_focus(text: String) -> Result<String, String> {
    if text.len() > 16 * 1024 { return Err("Current focus is limited to 16 KiB".into()); }
    let _guard = WRITE_LOCK.lock().map_err(|e| e.to_string())?;
    let mut config = load()?;
    config.focus = text;
    save(&config)?;
    Ok(config.focus)
}

fn validate_service(name: &str, url: &str, description: &str) -> Result<(), String> {
    if name.trim().is_empty() || name.chars().count() > 100 {
        return Err("Service name must contain 1–100 characters".into());
    }
    if description.chars().count() > 2000 { return Err("Description is limited to 2000 characters".into()); }
    if url.len() > 2048 || url.chars().any(char::is_control) {
        return Err("Invalid service URL".into());
    }
    let parsed = tauri::Url::parse(url).map_err(|_| "Invalid service URL")?;
    if !matches!(parsed.scheme(), "https" | "http") || parsed.host_str().is_none() {
        return Err("Service URL must use HTTP or HTTPS and include a host".into());
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("Do not put credentials in service URLs".into());
    }
    Ok(())
}

pub fn add_service(name: String, url: String, description: String) -> Result<Vec<Service>, String> {
    let (name, url, description) = (name.trim(), url.trim(), description.trim());
    validate_service(name, url, description)?;
    let _guard = WRITE_LOCK.lock().map_err(|e| e.to_string())?;
    let mut config = load()?;
    if config.services.len() >= 200 { return Err("The catalogue is limited to 200 services".into()); }
    loop {
        config.next_service_id = config.next_service_id.checked_add(1).ok_or("Service ID exhausted")?;
        let id = format!("service-{}", config.next_service_id);
        if config.services.iter().any(|s| s.id == id) { continue; }
        config.services.push(Service { id, name: name.into(), url: url.into(), description: description.into() });
        break;
    }
    save(&config)?;
    Ok(config.services)
}

pub fn delete_service(id: String) -> Result<Vec<Service>, String> {
    let _guard = WRITE_LOCK.lock().map_err(|e| e.to_string())?;
    let mut config = load()?;
    let count = config.services.len();
    config.services.retain(|s| s.id != id);
    if count == config.services.len() { return Err("Service not found".into()); }
    save(&config)?;
    Ok(config.services)
}

fn is_link(metadata: &Metadata) -> bool {
    if metadata.file_type().is_symlink() { return true; }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 { return true; } // FILE_ATTRIBUTE_REPARSE_POINT
    }
    false
}

/// Reject junctions/symlinks in every component, not just the final document.
fn checked_directory(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute() { return Err("Choose an absolute directory path".into()); }
    let mut current = PathBuf::new();
    for component in path.components() {
        match component {
            Component::ParentDir => return Err("Parent traversal is not allowed".into()),
            Component::CurDir => continue,
            _ => current.push(component.as_os_str()),
        }
        // A Windows drive prefix alone is not a directory (C: means drive-relative).
        if matches!(component, Component::Prefix(_)) { continue; }
        let metadata = fs::symlink_metadata(&current).map_err(|e| format!("Cannot access directory: {e}"))?;
        if is_link(&metadata) || !metadata.is_dir() {
            return Err("Memory directory must not contain symlinks or junctions".into());
        }
    }
    fs::canonicalize(path).map_err(|e| e.to_string())
}

fn memory_root(config: &ModuleConfig) -> Option<PathBuf> {
    config.memory_root.clone().or_else(|| {
        dirs::home_dir().map(|p| p.join("knowledge")).filter(|p| p.is_dir())
    })
}

fn markdown(path: &Path) -> bool {
    path.extension().and_then(|s| s.to_str())
        .map(|s| s.eq_ignore_ascii_case("md") || s.eq_ignore_ascii_case("markdown"))
        .unwrap_or(false)
}

fn modified(metadata: &Metadata) -> u64 {
    metadata.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn title(path: &Path) -> String {
    path.file_stem().unwrap_or_default().to_string_lossy().into_owned()
}

fn index_at(path: Option<PathBuf>) -> MemoryIndex {
    let mut index = MemoryIndex { available: false, root: path.as_ref().map(|p| p.display().to_string()),
        documents: Vec::new(), truncated: false, error: None };
    let Some(path) = path else { return index; };
    let root = match checked_directory(&path) {
        Ok(root) => root,
        Err(error) => { index.error = Some(error); return index; }
    };
    index.available = true;
    let mut pending = vec![(root.clone(), 0usize)];
    let mut inspected = 0;
    while let Some((dir, depth)) = pending.pop() {
        // Recheck queued directories immediately before walking them: an entry may have changed.
        match checked_directory(&dir) {
            Ok(checked) if checked.starts_with(&root) => {},
            _ => { index.truncated = true; continue; }
        }
        let entries = match fs::read_dir(&dir) {
            Ok(entries) => entries,
            Err(_) => { index.truncated = true; continue; }
        };
        for entry in entries {
            inspected += 1;
            if inspected > MAX_ENTRIES || index.documents.len() >= MAX_DOCUMENTS {
                index.truncated = true;
                return index;
            }
            let Ok(entry) = entry else { index.truncated = true; continue; };
            let path = entry.path();
            let Ok(metadata) = fs::symlink_metadata(&path) else { continue; };
            if is_link(&metadata) { continue; }
            if metadata.is_dir() {
                if depth < MAX_DEPTH { pending.push((path, depth + 1)); }
                else { index.truncated = true; }
            } else if metadata.is_file() && markdown(&path) && metadata.len() <= MAX_BYTES {
                let Ok(relative) = path.strip_prefix(&root) else { continue; };
                index.documents.push(MemoryDocument { id: relative.to_string_lossy().replace('\\', "/"),
                    title: title(&path), modified: modified(&metadata) });
            }
        }
    }
    index.documents.sort_by(|a, b| a.id.cmp(&b.id));
    index
}

pub fn get_memory() -> Result<MemoryIndex, String> { Ok(index_at(memory_root(&load()?))) }

pub fn set_memory_root(path: String) -> Result<MemoryIndex, String> {
    let root = checked_directory(Path::new(path.trim()))?;
    let _guard = WRITE_LOCK.lock().map_err(|e| e.to_string())?;
    let mut config = load()?;
    config.memory_root = Some(root.clone());
    save(&config)?;
    Ok(index_at(Some(root)))
}

fn document_path(root: &Path, id: &str) -> Result<PathBuf, String> {
    if id.is_empty() || id.contains(':') || id.contains('\\') || id.contains('\0') {
        return Err("Invalid document ID".into());
    }
    let relative = Path::new(id);
    if relative.components().any(|c| !matches!(c, Component::Normal(_))) || !markdown(relative) {
        return Err("Only relative Markdown document IDs are allowed".into());
    }
    if relative.components().count() > MAX_DEPTH + 1 { return Err("Document exceeds the depth limit".into()); }
    let joined = root.join(relative);
    checked_directory(joined.parent().ok_or("Missing document directory")?)?;
    let metadata = fs::symlink_metadata(&joined).map_err(|e| e.to_string())?;
    if is_link(&metadata) || !metadata.is_file() { return Err("Document must be a regular file".into()); }
    let canonical = fs::canonicalize(joined).map_err(|e| e.to_string())?;
    if !canonical.starts_with(root) { return Err("Document escapes the memory directory".into()); }
    Ok(canonical)
}

#[cfg(windows)]
fn handle_stays_under(file: &File, root: &Path) -> Result<(), String> {
    use std::os::windows::io::AsRawHandle;
    use std::os::windows::ffi::OsStringExt;
    #[link(name = "kernel32")]
    extern "system" {
        fn GetFinalPathNameByHandleW(handle: *mut core::ffi::c_void, path: *mut u16, size: u32, flags: u32) -> u32;
    }
    let mut buffer = vec![0u16; 32768];
    let length = unsafe { GetFinalPathNameByHandleW(file.as_raw_handle(), buffer.as_mut_ptr(), buffer.len() as u32, 0) };
    if length == 0 || length as usize >= buffer.len() { return Err("Cannot validate opened document path".into()); }
    let actual = PathBuf::from(std::ffi::OsString::from_wide(&buffer[..length as usize]));
    if !actual.starts_with(root) { return Err("Opened document escapes the memory directory".into()); }
    Ok(())
}

fn read_at(root: &Path, id: &str) -> Result<MemoryText, String> {
    let root = checked_directory(root)?;
    let path = document_path(&root, id)?;
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(0x00200000); // Open the final reparse point itself, never its target.
    }
    let file = options.open(&path).map_err(|e| e.to_string())?;
    let metadata = file.metadata().map_err(|e| e.to_string())?;
    if is_link(&metadata) || !metadata.is_file() || metadata.len() > MAX_BYTES {
        return Err("Document must be a regular Markdown file no larger than 256 KiB".into());
    }
    #[cfg(windows)]
    handle_stays_under(&file, &root)?;
    let mut bytes = Vec::new();
    file.take(MAX_BYTES + 1).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_BYTES { return Err("Document exceeds 256 KiB".into()); }
    let text = String::from_utf8(bytes).map_err(|_| "Document is not UTF-8 text")?;
    Ok(MemoryText { id: id.into(), title: title(&path), text, modified: modified(&metadata) })
}

pub fn read_memory(id: String) -> Result<MemoryText, String> {
    let root = memory_root(&load()?).ok_or("No memory directory configured")?;
    read_at(&root, &id)
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Scratch(PathBuf);
    impl Scratch {
        fn new() -> Self {
            static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
            let p = std::env::temp_dir().join(format!("codenotch-modules-{}-{}", std::process::id(), NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)));
            fs::create_dir_all(&p).unwrap();
            Self(p)
        }
    }
    impl Drop for Scratch { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }

    #[test]
    fn service_url_validation_rejects_credentials_and_non_web_protocols() {
        assert!(validate_service("Docs", "https://example.com/docs", "Reference").is_ok());
        for url in ["file:///secret", "javascript:alert(1)", "https://user:password@example.com", "no-url", "https://example.com/\n"] {
            assert!(validate_service("Docs", url, "").is_err(), "{url}");
        }
        assert!(validate_service(" ", "https://example.com", "").is_err());
    }

    #[test]
    fn memory_is_bounded_markdown_only_and_never_writes_documents() {
        let dir = Scratch::new();
        fs::create_dir(dir.0.join("sub")).unwrap();
        fs::write(dir.0.join("sub/note.md"), "# Привет\nMemory").unwrap();
        fs::write(dir.0.join("auth.json"), "private").unwrap();
        fs::write(dir.0.join("huge.md"), vec![b'a'; MAX_BYTES as usize + 1]).unwrap();
        let index = index_at(Some(dir.0.clone()));
        assert!(index.available);
        assert_eq!(index.documents.len(), 1);
        assert_eq!(index.documents[0].id, "sub/note.md");
        assert_eq!(read_at(&dir.0, "sub/note.md").unwrap().text, "# Привет\nMemory");
        assert!(read_at(&dir.0, "huge.md").is_err());
        for id in ["../secret.md", "/secret.md", "C:/secret.md", "sub\\note.md", "auth.json", "note.md:stream"] {
            assert!(read_at(&dir.0, id).is_err(), "{id}");
        }
        assert!(!index_at(None).available);
    }

    #[test]
    fn memory_document_count_is_capped() {
        let dir = Scratch::new();
        for i in 0..MAX_DOCUMENTS + 1 { fs::write(dir.0.join(format!("{i}.md")), "x").unwrap(); }
        let index = index_at(Some(dir.0.clone()));
        assert_eq!(index.documents.len(), MAX_DOCUMENTS);
        assert!(index.truncated);
    }

    #[test]
    fn memory_depth_limit_includes_eight_levels_but_not_nine() {
        let dir = Scratch::new();
        let mut nested = dir.0.clone();
        for _ in 0..MAX_DEPTH { nested.push("sub"); }
        fs::create_dir_all(&nested).unwrap();
        fs::write(nested.join("allowed.md"), "yes").unwrap();
        nested.push("too-deep");
        fs::create_dir(&nested).unwrap();
        fs::write(nested.join("hidden.md"), "no").unwrap();
        let index = index_at(Some(dir.0.clone()));
        assert_eq!(index.documents.len(), 1);
        assert!(index.documents[0].id.ends_with("allowed.md"));
        assert!(index.truncated);
        assert!(read_at(&dir.0, &format!("{}too-deep/hidden.md", "sub/".repeat(MAX_DEPTH))).is_err());
    }

    #[test]
    fn module_config_preserves_independent_sections_and_defaults() {
        let mut config: ModuleConfig = serde_json::from_str("{}").unwrap();
        assert!(config.focus.is_empty());
        assert!(config.services.is_empty());
        assert!(config.memory_root.is_none());
        config.focus = "Current project\nNext step".into();
        config.services.push(Service { id: "service-1".into(), name: "Docs".into(), url: "https://example.com".into(), description: "Links only".into() });
        let restored: ModuleConfig = serde_json::from_slice(&serde_json::to_vec(&config).unwrap()).unwrap();
        assert_eq!(restored.focus, config.focus);
        assert_eq!(restored.services, config.services);
    }

    #[cfg(unix)]
    #[test]
    fn memory_rejects_symlink_files_and_directories() {
        use std::os::unix::fs::symlink;
        let dir = Scratch::new();
        let outside = Scratch::new();
        fs::write(outside.0.join("secret.md"), "secret").unwrap();
        symlink(outside.0.join("secret.md"), dir.0.join("link.md")).unwrap();
        symlink(&outside.0, dir.0.join("linked")).unwrap();
        assert!(index_at(Some(dir.0.clone())).documents.is_empty());
        assert!(read_at(&dir.0, "link.md").is_err());
        assert!(read_at(&dir.0, "linked/secret.md").is_err());
    }
}
