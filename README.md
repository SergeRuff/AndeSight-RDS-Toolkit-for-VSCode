# AndeSight RDS Toolkit for VSCode

Runs the active `.gdb` script through the selected VS Code debug configuration.

## Andes ICEman

The extension can start Andes ICEman in a VS Code terminal before launching GDB.

Example workspace settings:

```json
{
  "gdbScriptRunner.iceman.enabled": true,
  "gdbScriptRunner.iceman.executable": "C:\\Andestech\\AndeSight_RDS_v511\\ice\\ICEman.exe",
  "gdbScriptRunner.iceman.args": [],
  "gdbScriptRunner.iceman.cwd": "C:\\Andestech\\AndeSight_RDS_v511\\ice",
  "gdbScriptRunner.iceman.andesRoot": "C:\\Andestech\\AndeSight_RDS_v511",
  "gdbScriptRunner.iceman.useAndesEnvironment": true,
  "gdbScriptRunner.iceman.startupDelayMs": 1000
}
```

When `gdbScriptRunner.iceman.useAndesEnvironment` is enabled, the extension opens the Andes Cygwin `bash.exe` in a VS Code terminal and starts ICEman there. The terminal environment matches the Andes launcher batch file:

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
