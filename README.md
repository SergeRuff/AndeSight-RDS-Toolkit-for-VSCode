# AndeSight RDS Toolkit for VSCode

Runs the active `.gdb` script through the selected VS Code debug configuration.

## Andes ICEman

The extension can start Andes ICEman in a VS Code terminal before launching GDB.

Example workspace settings:

```json
{
  "andesIceman.enabled": true,
  "andesIceman.executable": "C:\\Andestech\\AndeSight_RDS_v511\\ice\\ICEman.exe",
  "andesIceman.args": [],
  "andesIceman.cwd": "C:\\Andestech\\AndeSight_RDS_v511\\ice",
  "andesIceman.andesRoot": "C:\\Andestech\\AndeSight_RDS_v511",
  "andesIceman.useAndesEnvironment": true,
  "andesIceman.startupDelayMs": 10000
}
```

When `andesIceman.useAndesEnvironment` is enabled, the extension opens the Andes Cygwin `bash.exe` in a VS Code terminal and starts ICEman there. The terminal environment matches the Andes launcher batch file:

- `HOME` is set to `<andesRoot>\ice\`.
- `<andesRoot>\cygwin\bin` and `<andesRoot>\ice\` are prepended to `PATH`.
- `SHELL` is set to `/bin/bash` when `bash.exe` exists in the Andes Cygwin directory.
- `CYGPATH` is set to `cygpath`.

ICEman output stays in the VS Code terminal.

Commands:

- `Start Andes ICEman`
- `Stop Andes ICEman`
- `Run GDB Script (F5)`

Use `launch.json` target settings to connect GDB to the ICEman server. Keep `target remote ...` out of `.gdb` scripts when using the CDT `gdbtarget` configurations.
