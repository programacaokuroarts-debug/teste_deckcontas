fn main() {
    // Comandos do app registrados em generate_handler! (lib.rs).
    //
    // Assim que existe qualquer permissão de app, a ACL passa a ser
    // exigida em TODAS as janelas. Por isso todo comando novo precisa
    // entrar aqui (gera allow-<comando>) e em capabilities/default.json
    // (janela principal). A janela do jogo (origem remota pokeidle.io)
    // só recebe o que estiver em capabilities/game-view.json.
    let resultado = tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&[
                "greet",
                "open_game_account",
                "is_account_open",
                "close_game_account",
                "create_game_webview",
                "update_game_webview_bounds",
                "hide_game_webview",
                "is_game_webview_open",
                "close_game_webview",
                "pause_game_webview",
                "resume_game_webview",
                "test_game_webview_js",
                "set_ball_automation",
                "set_shop_automation",
                "set_solo_mode",
                "toggle_solo_panel",
                "aplicar_opcoes_solo",
            ]),
        ),
    );

    if let Err(erro) = resultado {
        panic!("error while running tauri-build: {erro}");
    }
}
