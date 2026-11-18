// sherpa-rs links sherpa-onnx dynamically and copies its .so files next to the binary,
// so the binary looks for them in its own folder.
fn main() {
    #[cfg(target_os = "linux")]
    println!("cargo:rustc-link-arg=-Wl,-rpath,$ORIGIN");
}
