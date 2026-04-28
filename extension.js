const fs = require("fs");
const path = require("path");
const vscode = require("vscode");

let outputChannel;
let tailTimer;
let lastLogPath;
let tailState = {
    filePath: undefined,
    offset: 0,
    partial: ""
};

function getOutputChannel() {
    if (!outputChannel) {
        outputChannel = vscode.window.createOutputChannel("GDB Script");
    }

    return outputChannel;
}

function decodeMiString(value) {
    return value
        .replace(/\\n/g, "\n")
        .replace(/\\t/g, "\t")
        .replace(/\\"/g, "\"")
        .replace(/\\\\/g, "\\");
}

function cleanMiLine(line) {
    const match = line.match(/^[~&@]"(.*)"$/);
    if (!match) {
        return null;
    }

    return decodeMiString(match[1]);
}

function stopTail() {
    if (tailTimer) {
        clearInterval(tailTimer);
        tailTimer = undefined;
    }

    tailState = {
        filePath: undefined,
        offset: 0,
        partial: ""
    };
}

function readNewLogData(channel) {
    if (!tailState.filePath) {
        return;
    }

    let stat;

    try {
        stat = fs.statSync(tailState.filePath);
    } catch {
        return;
    }

    if (stat.size < tailState.offset) {
        tailState.offset = 0;
        tailState.partial = "";
    }

    if (stat.size === tailState.offset) {
        return;
    }

    const fd = fs.openSync(tailState.filePath, "r");

    try {
        const length = stat.size - tailState.offset;
        const buffer = Buffer.alloc(length);

        fs.readSync(fd, buffer, 0, length, tailState.offset);
        tailState.offset = stat.size;

        const text = tailState.partial + buffer.toString("utf8");
        const lines = text.split(/\r?\n/);

        tailState.partial = lines.pop() || "";

        for (const line of lines) {
            const cleaned = cleanMiLine(line);

            if (cleaned !== null && cleaned.length > 0) {
                channel.append(cleaned);
            }
        }
    } finally {
        fs.closeSync(fd);
    }
}

function startTail(logPath) {
    stopTail();

    lastLogPath = logPath;

    const channel = getOutputChannel();
    channel.clear();
    channel.show(true);

    tailState = {
        filePath: logPath,
        offset: 0,
        partial: ""
    };

    tailTimer = setInterval(() => readNewLogData(channel), 200);
}

function getDefaultLaunchJson() {
    return {
        version: "0.2.0",
        configurations: [
            {
                name: "GDB-Multiarch: run script file",
                type: "cppdbg",
                request: "launch",
                MIMode: "gdb",
                miDebuggerPath: "gdb-multiarch.exe",
                targetArchitecture: "x86",

                program: "${workspaceFolder}/${config:gdbScriptRunner.program}",
                cwd: "${workspaceFolder}",

                setupCommands: [
                    { text: "set logging file ${cwd}/gdb-session.log" },
                    { text: "set logging overwrite on" },
                    { text: "set logging redirect off" },
                    { text: "set logging enabled on" }
                ],

                customLaunchSetupCommands: [
                    { text: "cd ${cwd}" },
                    { text: "file ${config:gdbScriptRunner.program}" },
                    { text: "source ${fileBasename}" }
                ],

                launchCompleteCommand: "None",
                logging: {}
            }
        ]
    };
}

async function ensureLaunchJson(folder) {
    const vscodeDir = path.join(folder.uri.fsPath, ".vscode");
    const launchPath = path.join(vscodeDir, "launch.json");

    if (fs.existsSync(launchPath)) {
        return;
    }

    const answer = await vscode.window.showWarningMessage(
        `No .vscode/launch.json found in "${folder.name}". Create a default GDB Script Runner launch.json?`,
        "Create",
        "Skip"
    );

    if (answer !== "Create") {
        return;
    }

    await fs.promises.mkdir(vscodeDir, { recursive: true });

    const content = JSON.stringify(getDefaultLaunchJson(), null, 4) + "\n";
    await fs.promises.writeFile(launchPath, content, "utf8");

    vscode.window.showInformationMessage("Created .vscode/launch.json for GDB Script Runner.");
}

function expandConfigValue(value, editor, folder) {
    if (typeof value === "string") {
        return value
            .replace(/\$\{file\}/g, editor.document.uri.fsPath)
            .replace(/\$\{fileBasename\}/g, path.basename(editor.document.uri.fsPath))
            .replace(/\$\{workspaceFolder\}/g, folder.uri.fsPath)
            .replace(/\$\{cwd\}/g, folder.uri.fsPath);
    }

    if (Array.isArray(value)) {
        return value.map((item) => expandConfigValue(item, editor, folder));
    }

    if (value && typeof value === "object") {
        const result = {};

        for (const [key, nestedValue] of Object.entries(value)) {
            result[key] = expandConfigValue(nestedValue, editor, folder);
        }

        return result;
    }

    return value;
}

function getDebugConfiguration(folder, editor) {
    const launch = vscode.workspace.getConfiguration("launch", folder.uri);
    const configurations = launch.get("configurations", []);

    const selectedName = vscode.workspace.getConfiguration("debug").get("selectedConfiguration");
    const baseConfig =
        configurations.find((config) => config.name === selectedName) ||
        configurations.find((config) => config.name === "GDB-Multiarch: run script file") ||
        configurations[0];

    if (!baseConfig) {
        return undefined;
    }

    return expandConfigValue(baseConfig, editor, folder);
}

async function activate(context) {
    if (vscode.workspace.workspaceFolders) {
        for (const folder of vscode.workspace.workspaceFolders) {
            await ensureLaunchJson(folder);
        }
    }

    const disposable = vscode.commands.registerCommand("gdbScript.runCurrent", async () => {
        const editor = vscode.window.activeTextEditor;

        if (!editor || !editor.document.fileName.endsWith(".gdb")) {
            vscode.window.showWarningMessage("Open a .gdb script first.");
            return;
        }

        const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);

        if (!folder) {
            vscode.window.showErrorMessage("The .gdb file is not inside an opened workspace folder.");
            return;
        }

        const logPath = path.join(folder.uri.fsPath, "gdb-session.log");
        startTail(logPath);

        const config = getDebugConfiguration(folder, editor);

        if (!config) {
            vscode.window.showErrorMessage("No debug configuration found in launch.json.");
            return;
        }

        await vscode.debug.startDebugging(folder, config);

    });

    const startDisposable = vscode.debug.onDidStartDebugSession(() => {
        if (!tailTimer && lastLogPath) {
            startTail(lastLogPath);
        }
    });

    const terminateDisposable = vscode.debug.onDidTerminateDebugSession(() => {
        const channel = getOutputChannel();
        readNewLogData(channel);
        stopTail();
    });

    context.subscriptions.push(disposable, startDisposable, terminateDisposable, { dispose: stopTail });
}

function deactivate() {
    stopTail();

    if (outputChannel) {
        outputChannel.dispose();
        outputChannel = undefined;
    }
}

module.exports = {
    activate,
    deactivate
};
