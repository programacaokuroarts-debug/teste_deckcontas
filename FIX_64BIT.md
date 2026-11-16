# 🔧 Correção para Build de 64 bits

## Problema
O executável gerado é de 32 bits, mas o Windows é de 64 bits.

## Solução

### 1. Verificar arquitetura do Rust

Abra o CMD e execute:
```cmd
rustc --version --verbose
```

Verifique se aparece `x86_64-pc-windows-msvc` ou `x86_64-pc-windows-gnu`.

### 2. Configurar para 64 bits

#### Opção A: Usar target específico

1. **Adicione o target de 64 bits:**
```cmd
rustup target add x86_64-pc-windows-msvc
```

2. **Compile especificando o target:**
```cmd
cargo build --release --target x86_64-pc-windows-msvc
```

3. **O executável estará em:**
```
target\x86_64-pc-windows-msvc\release\deckcontas.exe
```

#### Opção B: Configurar no Cargo.toml

Adicione ao `Cargo.toml`:
```toml
[package]
# ... configurações existentes ...

[profile.release]
# ... configurações existentes ...
target = "x86_64-pc-windows-msvc"
```

### 3. Verificar se o Rust está instalado para 64 bits

Execute:
```cmd
rustup show
```

Deve aparecer algo como:
```
Default host: x86_64-pc-windows-msvc
```

Se aparecer `i686-pc-windows-msvc`, você precisa reinstalar o Rust para 64 bits.

### 4. Reinstalar Rust para 64 bits (se necessário)

1. Desinstale o Rust atual:
```cmd
rustup self uninstall
```

2. Reinstale com suporte a 64 bits:
- Baixe do site: https://www.rust-lang.org/tools/install
- Ou execute no PowerShell:
```powershell
winget install Rustlang.Rustup
```

3. Verifique a instalação:
```cmd
rustc --version
```

### 5. Build completo para 64 bits

Depois de configurado:
```cmd
cd src-tauri
cargo build --release --target x86_64-pc-windows-msvc
```

### 6. Copiar para pasta de build

```cmd
copy target\x86_64-pc-windows-msvc\release\deckcontas.exe ..\build-release-20261116-001\deckcontas.exe
```

### 7. Iniciar o programa

Duplo clique em: `build-release-20261116-001\iniciar.bat`

---

## 📋 Comando completo para build de 64 bits

```cmd
cd /d "C:\Users\KURO\Downloads\Telegram Desktop\deckcontas\deckcontas\src-tauri"
rustup target add x86_64-pc-windows-msvc
cargo build --release --target x86_64-pc-windows-msvc
copy target\x86_64-pc-windows-msvc\release\deckcontas.exe ..\build-release-20261116-001\deckcontas.exe
```

---

## 🔍 Verificar se o executável é de 64 bits

Use o comando:
```cmd
dumpbin /headers deckcontas.exe | findstr machine
```

Deve aparecer: `8664 machine (x64)`

---

## ⚠️ Se o problema persistir

1. **Verifique o WebView2:**
   - O Tauri usa WebView2 que deve ser de 64 bits
   - Baixe: https://developer.microsoft.com/en-us/microsoft-edge/webview2/

2. **Use o Tauri com configuração explícita:**
   ```toml
   [dependencies]
   tauri = { version = "2", features = ["unstable", "windows-64bit"] }
   ```

3. **Verifique o sistema:**
   - Windows 10/11 de 64 bits
   - Rust de 64 bits
   - WebView2 de 64 bits

---

## 📞 Suporte

GitHub: https://github.com/programacaokuroarts-debug/teste_deckcontas

Tags: `multi-account-optimization-complete`