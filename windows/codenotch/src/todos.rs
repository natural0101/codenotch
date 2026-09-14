//! Personal checklist, independent of credentials and agent execution.
//! Every mutation rereads and validates disk under one process-wide transaction lock.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

const MAX_ITEMS: usize = 500;
const MAX_TEXT: usize = 4000;
const MAX_BYTES: u64 = 9_000_000;
static TRANSACTION: Mutex<()> = Mutex::new(());
static SERIAL: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Todo {
    pub id: String,
    pub text: String,
    pub completed: bool,
}

#[derive(Serialize, Deserialize)]
struct Document {
    version: u32,
    items: Vec<Todo>,
}

fn path() -> PathBuf {
    crate::config::config_path().with_file_name("todos.json")
}

fn unique_id() -> String {
    let tick = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!(
        "{tick:x}-{:x}-{:x}",
        std::process::id(),
        SERIAL.fetch_add(1, Ordering::Relaxed)
    )
}

fn normalized(text: &str) -> Result<String, String> {
    let value = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if value.is_empty() || value.chars().count() > MAX_TEXT {
        return Err("A task needs 1 to 4000 characters.".into());
    }
    Ok(value)
}

fn validate(items: &[Todo]) -> Result<(), String> {
    if items.len() > MAX_ITEMS {
        return Err("The checklist can hold up to 500 tasks.".into());
    }
    let mut ids = HashSet::new();
    for item in items {
        if item.id.is_empty()
            || item.id.len() > 128
            || !ids.insert(&item.id)
            || normalized(&item.text)? != item.text
        {
            return Err("The checklist file is invalid and has been left unchanged.".into());
        }
    }
    Ok(())
}

fn read_from(file: &Path) -> Result<Vec<Todo>, String> {
    let metadata = match std::fs::symlink_metadata(file) {
        Ok(value) => value,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(_) => {
            return Err("Cannot read the checklist. The file has been left unchanged.".into())
        }
    };
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > MAX_BYTES {
        return Err("The checklist file is invalid and has been left unchanged.".into());
    }
    let source = std::fs::File::open(file)
        .map_err(|_| "Cannot open the checklist. The file has been left unchanged.")?;
    let mut bytes = Vec::new();
    source
        .take(MAX_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Cannot read the checklist. The file has been left unchanged.")?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err("The checklist file is too large and has been left unchanged.".into());
    }
    let document: Document = serde_json::from_slice(&bytes)
        .map_err(|_| "The checklist file is damaged and has been left unchanged.")?;
    if document.version != 1 {
        return Err(
            "This checklist version is unsupported. The file has been left unchanged.".into(),
        );
    }
    validate(&document.items)?;
    Ok(document.items)
}

#[cfg(windows)]
fn replace_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    extern "system" {
        fn MoveFileExW(source: *const u16, destination: *const u16, flags: u32) -> i32;
    }
    let from: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let to: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    // Same-directory rename; never delete the old file first. WRITE_THROUGH waits
    // for the move to reach disk, after the temp file's contents were flushed.
    let result = unsafe { MoveFileExW(from.as_ptr(), to.as_ptr(), 0x1 | 0x8) };
    if result == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn replace_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    std::fs::rename(source, destination)
}

fn write_to(file: &Path, items: &[Todo]) -> Result<(), String> {
    validate(items)?;
    let bytes = serde_json::to_vec_pretty(&Document {
        version: 1,
        items: items.to_vec(),
    })
    .map_err(|_| "Cannot encode the checklist.")?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err("The checklist is too large to save.".into());
    }
    let parent = file
        .parent()
        .ok_or("The checklist folder is unavailable.")?;
    std::fs::create_dir_all(parent).map_err(|_| "Cannot create the checklist folder.")?;
    let temporary = parent.join(format!(".todos-{}.tmp", unique_id()));
    let result = (|| -> std::io::Result<()> {
        let mut output = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        output.write_all(&bytes)?;
        output.sync_all()?;
        drop(output);
        replace_file(&temporary, file)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
        return Err("Cannot save the checklist. Previous tasks have been kept; try again.".into());
    }
    Ok(())
}

fn change_at(
    file: &Path,
    operation: impl FnOnce(&mut Vec<Todo>) -> Result<(), String>,
) -> Result<Vec<Todo>, String> {
    let _transaction = TRANSACTION
        .lock()
        .map_err(|_| "The checklist is temporarily unavailable.")?;
    let mut items = read_from(file)?;
    operation(&mut items)?;
    write_to(file, &items)?;
    Ok(items)
}

pub fn list() -> Result<Vec<Todo>, String> {
    let _transaction = TRANSACTION
        .lock()
        .map_err(|_| "The checklist is temporarily unavailable.")?;
    read_from(&path())
}

fn add_to(file: &Path, text: String) -> Result<Vec<Todo>, String> {
    let text = normalized(&text)?;
    change_at(file, |items| {
        items.insert(
            0,
            Todo {
                id: unique_id(),
                text,
                completed: false,
            },
        );
        Ok(())
    })
}

pub fn add(text: String) -> Result<Vec<Todo>, String> {
    add_to(&path(), text)
}

fn update_at(
    file: &Path,
    id: String,
    text: Option<String>,
    completed: Option<bool>,
) -> Result<Vec<Todo>, String> {
    let text = text.map(|value| normalized(&value)).transpose()?;
    change_at(file, |items| {
        let item = items
            .iter_mut()
            .find(|item| item.id == id)
            .ok_or("This task no longer exists.")?;
        if let Some(text) = text {
            item.text = text;
        }
        if let Some(completed) = completed {
            item.completed = completed;
        }
        Ok(())
    })
}

pub fn update(
    id: String,
    text: Option<String>,
    completed: Option<bool>,
) -> Result<Vec<Todo>, String> {
    update_at(&path(), id, text, completed)
}

fn delete_at(file: &Path, id: String) -> Result<Vec<Todo>, String> {
    change_at(file, |items| {
        let index = items
            .iter()
            .position(|item| item.id == id)
            .ok_or("This task no longer exists.")?;
        items.remove(index);
        Ok(())
    })
}

pub fn delete(id: String) -> Result<Vec<Todo>, String> {
    delete_at(&path(), id)
}

fn reorder_at(file: &Path, ids: Vec<String>) -> Result<Vec<Todo>, String> {
    change_at(file, |items| {
        let mut by_id: HashMap<_, _> = items
            .iter()
            .map(|item| (item.id.clone(), item.clone()))
            .collect();
        if ids.len() != items.len() {
            return Err("The checklist changed. Refresh it before reordering.".into());
        }
        let mut ordered = Vec::with_capacity(items.len());
        for id in ids {
            ordered.push(
                by_id
                    .remove(&id)
                    .ok_or("The checklist changed. Refresh it before reordering.")?,
            );
        }
        *items = ordered;
        Ok(())
    })
}

pub fn reorder(ids: Vec<String>) -> Result<Vec<Todo>, String> {
    reorder_at(&path(), ids)
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!("codenotch-todos-{}", unique_id()));
            std::fs::create_dir(&root).unwrap();
            Self(root)
        }
        fn file(&self) -> PathBuf {
            self.0.join("todos.json")
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn add_edit_complete_restore_reorder_delete_persist() {
        let f = Fixture::new();
        let file = f.file();
        assert!(read_from(&file).unwrap().is_empty());
        let first = add_to(&file, "  First\n task  ".into()).unwrap()[0].clone();
        assert_eq!(first.text, "First task");
        let second = add_to(&file, "Second".into()).unwrap()[0].clone();
        let result =
            update_at(&file, first.id.clone(), Some("Updated".into()), Some(true)).unwrap();
        assert!(result[1].completed);
        update_at(&file, first.id.clone(), None, Some(false)).unwrap();
        let ordered = reorder_at(&file, vec![first.id.clone(), second.id.clone()]).unwrap();
        assert_eq!(ordered[0].text, "Updated");
        assert!(!ordered[0].completed);
        assert_eq!(read_from(&file).unwrap(), ordered);
        let remaining = delete_at(&file, first.id).unwrap();
        assert_eq!(remaining, vec![second]);
        assert_eq!(read_from(&file).unwrap(), remaining);
    }

    #[test]
    fn corrupt_or_future_document_is_never_overwritten() {
        let f = Fixture::new();
        for bytes in [b"broken".as_slice(), br#"{"version":2,"items":[]}"#.as_slice(),
            br#"{"version":1,"items":[{"id":"a","text":"A","completed":false},{"id":"a","text":"B","completed":false}]}"#.as_slice()] {
            std::fs::write(f.file(), bytes).unwrap();
            assert!(add_to(&f.file(), "New".into()).is_err());
            assert_eq!(std::fs::read(f.file()).unwrap(), bytes);
        }
    }

    #[test]
    fn invalid_reorders_and_missing_updates_preserve_data() {
        let f = Fixture::new();
        let first = add_to(&f.file(), "One".into()).unwrap()[0].id.clone();
        add_to(&f.file(), "Two".into()).unwrap();
        let before = std::fs::read(f.file()).unwrap();
        assert!(reorder_at(&f.file(), vec![first.clone()]).is_err());
        assert!(reorder_at(&f.file(), vec![first.clone(), first]).is_err());
        assert!(update_at(&f.file(), "missing".into(), None, Some(true)).is_err());
        assert!(delete_at(&f.file(), "missing".into()).is_err());
        assert_eq!(std::fs::read(f.file()).unwrap(), before);
    }

    #[test]
    fn limits_count_unicode_characters_and_reject_501st_task() {
        let f = Fixture::new();
        assert!(normalized("  \n ").is_err());
        assert!(normalized(&"я".repeat(4000)).is_ok());
        assert!(normalized(&"я".repeat(4001)).is_err());
        let full: Vec<_> = (0..MAX_ITEMS)
            .map(|i| Todo {
                id: i.to_string(),
                text: "Task".into(),
                completed: false,
            })
            .collect();
        write_to(&f.file(), &full).unwrap();
        let before = std::fs::read(f.file()).unwrap();
        assert!(add_to(&f.file(), "Too many".into()).is_err());
        assert_eq!(std::fs::read(f.file()).unwrap(), before);
    }

    #[test]
    fn concurrent_additions_do_not_lose_tasks() {
        let f = Fixture::new();
        let workers: Vec<_> = (0..8)
            .map(|i| {
                let file = f.file();
                std::thread::spawn(move || add_to(&file, format!("Task {i}")).unwrap())
            })
            .collect();
        for worker in workers {
            worker.join().unwrap();
        }
        assert_eq!(read_from(&f.file()).unwrap().len(), 8);
    }

    #[cfg(windows)]
    #[test]
    fn failed_windows_replace_preserves_old_file_and_cleans_temp() {
        use std::os::windows::fs::OpenOptionsExt;
        let f = Fixture::new();
        let existing = add_to(&f.file(), "Saved".into()).unwrap();
        let before = std::fs::read(f.file()).unwrap();
        let held = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(1)
            .open(f.file())
            .unwrap();
        assert!(write_to(&f.file(), &[]).is_err());
        drop(held);
        assert_eq!(std::fs::read(f.file()).unwrap(), before);
        assert_eq!(read_from(&f.file()).unwrap(), existing);
        assert_eq!(std::fs::read_dir(&f.0).unwrap().count(), 1);
    }
}
