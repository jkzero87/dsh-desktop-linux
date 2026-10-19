# DeepSeek Harness — Linux

Guía para compilar el AppImage de Linux de la app de escritorio, instalarlo por
usuario, instalar el perfil de AppArmor y desinstalar. Todas las rutas, flags y
scripts de este documento existen en este repositorio.

El set de parches Linux (target AppImage, worker de raster, resolución del kit de Office, identidad de ventana, sin política de actualización obligatoria) viene de [mtaech/dsh-linux-patch](https://github.com/mtaech/dsh-linux-patch) (MIT); este port aplica encima sus propios commits. La licencia es el `LICENSE` del repositorio, sin cambios.

## Compilar el AppImage

Requisitos del host de compilación:

- **Node.js** `^22.19.0 || >=24.0.0` y **pnpm** `11.28.5` (ver `engines` y
  `packageManager` en `package.json`).
- **Linux x64**: `package-target.ts` rechaza `linux-x64` si el host no es
  Linux x64.

El empaquetado lee `apps/desktop/.env.linux`, que está en `.gitignore` y no
viene en el clon; sin él falla con `cannot read …/apps/desktop/.env.linux`.
Créalo una vez con este contenido mínimo (no lleva secretos; Linux no firma
nada):

```sh
cat > apps/desktop/.env.linux <<'EOF'
DSH_DESKTOP_APP_ID=com.deepseek.harness
DSH_DESKTOP_AUTO_UPDATE_ENV=test
DOWNLOAD_TEST_ORIGIN=
DOWNLOAD_TEST_RELEASE_ID=
EOF
```

La plantilla completa, con los campos opcionales, es
`apps/desktop/.env.linux.example`.

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
# crear apps/desktop/.env.linux (arriba)
cd apps/desktop
pnpm exec tsx scripts/package-target.ts linux-x64 --unsigned
```

Se compila con `--unsigned` a propósito: sin esa opción
`electron-builder-config.mjs` resuelve un feed de actualización
(`resolveDesktopAutoUpdateConfig`) y lo graba en el paquete, y el despliegue `test` exige
`DOWNLOAD_TEST_ORIGIN` (https) y un `DOWNLOAD_TEST_RELEASE_ID` de 32
caracteres hexadecimales. Con `--unsigned` el paquete sale
con `publish: null`: sin feed de actualización ni firma. El script
`package:linux:x64` de `apps/desktop/package.json` no pasa `--unsigned`. La
secuencia completa corre sola: `pnpm run
build:official`, los empaquetados `release:pack` (familias `dsh` y `vendor`),
el empaquetado de `native/system`, `prepare:runtime`, `prepare:packages`,
`prepare:dsh`, y luego electron-builder con `--config
electron-builder.config.mjs --linux --x64 --publish never` (target `AppImage`),
terminando con el smoke test del runtime empaquetado
(`scripts/smoke-packaged-runtime.ts --unsigned`).

El artefacto se genera en:

```
apps/desktop/.desktop-build/targets/linux-x64/unsigned-artifacts/
  deepseek-harness-<version>-linux-x86_64-unsigned.AppImage
```

y junto a él queda la aplicación desempaquetada `linux-unpacked/`. El AppImage
incluye el ejecutable `deepseek-harness` y un `AppRun` que electron-builder
genera para el target AppImage.

Si solo quieres validar la herramienta y la configuración sin compilar, desde
`apps/desktop/`:

```sh
pnpm run check:package -- linux-x64 --unsigned
```

## Instalar por usuario

```sh
apps/desktop/scripts/install-linux-local.sh
```

o pasando explícitamente el AppImage:

```sh
apps/desktop/scripts/install-linux-local.sh path/to/deepseek-harness-<version>-linux-x86_64-unsigned.AppImage
```

Sin argumento, el script busca el `*.AppImage` más reciente en
`apps/desktop/.desktop-build/targets/linux-x64/unsigned-artifacts/`.

El script extrae el AppImage sin FUSE (`--appimage-extract`) y lo coloca de
forma atómica en `~/Applications/DeepSeek-Harness/`, y escribe además:

- `~/.local/share/applications/deepseek-harness.desktop` (entrada de escritorio,
  `Name=DeepSeek Harness`, `Categories=Development;`,
  `StartupWMClass=deepseek-harness`).
- Iconos `deepseek-harness.png` en
  `~/.local/share/icons/hicolor/<16x16…1024x1024>/apps/`.
- `~/Applications/DeepSeek-Harness/deepseek-harness.apparmor`, generado desde la
  plantilla `apps/desktop/packaging/linux/apparmor/deepseek-harness`.

El directorio de datos de la app (`DSH_HOME`) se fija por defecto en
`~/.local/share/deepseek-harness`; se puede sobrescribir al instalar con la
variable de entorno `DSH_HOME_DIR` (nunca `~/.dsh`, que pertenece al paquete npm
`dsh`).

## Instalar el perfil de AppArmor

Desde Ubuntu 23.10+ los procesos sin confinar no pueden crear namespaces de
usuario sin privilegios, así que Chromium (lanzado desde GNOME) cae al
`chrome-sandbox` setuid y aborta. El perfil de AppArmor del app (no confinado,
con permiso `userns`, como el propio perfil de chrome de Ubuntu) levanta esa
restricción solo para el binario instalado. Instalarlo requiere root, por lo
que el script **imprime** los comandos en vez de ejecutarlos:

```sh
apps/desktop/scripts/install-linux-local.sh --apparmor
```

Después ejecuta los comandos que imprime:

```sh
sudo install -m 644 ~/Applications/DeepSeek-Harness/deepseek-harness.apparmor /etc/apparmor.d/deepseek-harness
sudo apparmor_parser -r /etc/apparmor.d/deepseek-harness
apps/desktop/scripts/install-linux-local.sh --desktop-entry
```

`--desktop-entry` reescribe solo la entrada de escritorio. Si
`/etc/apparmor.d/deepseek-harness` coincide con el perfil generado, `Exec`
apunta directamente al binario `deepseek-harness` (Chromium conserva su
sandbox). Sin el perfil, `Exec` usa el `AppRun` incluido, que añade
`--no-sandbox` cuando `unshare -Ur true` falla; es solo un respaldo, porque
`AppRun` es un script bash que el perfil no cubre.

## Desinstalar

```sh
apps/desktop/scripts/install-linux-local.sh --uninstall
```

Elimina exactamente lo que la instalación escribió:

- `~/Applications/DeepSeek-Harness/` (aplicación extraída incluido el perfil
  generado).
- `~/.local/share/applications/deepseek-harness.desktop`.
- `~/.local/share/icons/hicolor/<size>/apps/deepseek-harness.png`.

No toca los datos en `DSH_HOME` (por defecto
`~/.local/share/deepseek-harness`). Si el perfil de AppArmor sigue instalado
(`/etc/apparmor.d/deepseek-harness`), el script imprime los comandos para
eliminarlo:

```sh
sudo apparmor_parser -R /etc/apparmor.d/deepseek-harness && sudo rm /etc/apparmor.d/deepseek-harness
```
