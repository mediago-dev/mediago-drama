fn main() {
    println!("cargo:rerun-if-env-changed=MEDIAGO_AGENT_ID");
    println!("cargo:rerun-if-env-changed=MEDIAGO_SERVER_PORT");
    tauri_build::build()
}
