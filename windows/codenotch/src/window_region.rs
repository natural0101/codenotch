//! Clip the native window to visible UI. Transparent WebView pixels still intercept input
//! unless the HWND region excludes them; CSS pointer-events cannot pass clicks to other apps.
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

static LAST: Mutex<Option<Vec<[i32; 4]>>> = Mutex::new(None);

fn bounds(rects: Vec<[f64; 4]>, width: u32, height: u32) -> Vec<[i32; 4]> {
    rects.into_iter().take(8).filter_map(|r| {
        if !r.iter().all(|v| v.is_finite()) || r[2] <= 0.0 || r[3] <= 0.0 { return None; }
        let x0=r[0].floor().clamp(0.0,width as f64) as i32;
        let y0=r[1].floor().clamp(0.0,height as f64) as i32;
        let x1=(r[0]+r[2]).ceil().clamp(0.0,width as f64) as i32;
        let y1=(r[1]+r[3]).ceil().clamp(0.0,height as f64) as i32;
        (x1>x0 && y1>y0).then_some([x0,y0,x1,y1])
    }).collect()
}

#[tauri::command]
pub fn set_hit_regions(app: AppHandle, rects: Vec<[f64; 4]>) -> Result<(), String> {
    let window=app.get_webview_window("notch").ok_or("Notch window missing")?;
    let size=window.outer_size().map_err(|e|e.to_string())?;
    let rectangles=bounds(rects,size.width,size.height);
    let mut last=LAST.lock().map_err(|e|e.to_string())?;
    if last.as_ref()==Some(&rectangles) { return Ok(()); }
    #[cfg(windows)]
    unsafe {
        use windows::Win32::Graphics::Gdi::{CreateRectRgn,CombineRgn,DeleteObject,SetWindowRgn,RGN_OR};
        let raw=window.hwnd().map_err(|e|e.to_string())?;
        let hwnd=windows::Win32::Foundation::HWND(raw.0 as *mut core::ffi::c_void);
        let region=CreateRectRgn(0,0,0,0);
        if region.is_invalid() { return Err("CreateRectRgn failed".into()); }
        for r in &rectangles {
            let part=CreateRectRgn(r[0],r[1],r[2],r[3]);
            if part.is_invalid() {
                let _=DeleteObject(region);
                return Err("CreateRectRgn failed".into());
            }
            let result=CombineRgn(region,region,part,RGN_OR);
            let _=DeleteObject(part);
            if result.0==0 {
                let _=DeleteObject(region);
                return Err("CombineRgn failed".into());
            }
        }
        if SetWindowRgn(hwnd,region,true)==0 {
            let _=DeleteObject(region);
            return Err("SetWindowRgn failed".into());
        }
        // Windows owns region after successful SetWindowRgn. Do not delete it.
    }
    crate::applog(&format!("hit regions: {rectangles:?}"));
    *last=Some(rectangles);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn collapsed_panel_excludes_the_transparent_left_side() {
        let r=bounds(vec![[270.0,70.0,70.0,320.0]],340,460);
        assert_eq!(r,vec![[270,70,340,390]]);
        assert!(!r.iter().any(|r|30>=r[0] && 30<r[2] && 230>=r[1] && 230<r[3]));
    }
    #[test]
    fn invalid_rectangles_are_dropped_and_dpi_edges_round_outward() {
        assert_eq!(bounds(vec![[10.2,20.3,20.5,30.6],[f64::NAN,0.0,1.0,1.0],[-5.0,-5.0,10.0,10.0]],340,460),
            vec![[10,20,31,51],[0,0,5,5]]);
        assert!(bounds(vec![],340,460).is_empty());
    }
}
