const fs = require("fs");
const path = require("path");
const vscode = require("vscode");

let outputChannel;
let icemanTerminal;
let tailTimer;
let lastLogPath;
let extensionPath;
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

function getWorkspaceFolderForCommand(editor) {
    if (editor) {
        const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);

        if (folder) {
            return folder;
        }
    }

    return vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
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

async function ensureLaunchJson(context, folder) {
    const vscodeDir = path.join(folder.uri.fsPath, ".vscode");
    const launchPath = path.join(vscodeDir, "launch.json");

    if (fs.existsSync(launchPath)) {
        return;
    }

    const answer = await vscode.window.showWarningMessage(
        `No .vscode/launch.json found in "${folder.name}". Create a default launch.json for GDB Scripts?`,
        "Create",
        "Skip"
    );

    if (answer !== "Create") {
        return;
    }

    const templatePath = path.join(context.extensionPath, "launch_default.json");

    let content;
    try {
        content = await fs.promises.readFile(templatePath, "utf8");
    } catch (error) {
        vscode.window.showErrorMessage(`Template not found: ${templatePath}`);
        return;
    }

    await fs.promises.mkdir(vscodeDir, { recursive: true });
    await fs.promises.writeFile(launchPath, content, "utf8");

    vscode.window.showInformationMessage("Created .vscode/launch.json for GDB Scripts Runner.");
}


function expandConfigValue(value, editor, folder) {
    if (typeof value === "string") {
        const filePath = editor ? editor.document.uri.fsPath : "";
        const folderPath = folder ? folder.uri.fsPath : "";
        const workspaceConfig = vscode.workspace.getConfiguration(undefined, folder && folder.uri);

        return value
            .replace(/\$\{file\}/g, filePath)
            .replace(/\$\{fileBasename\}/g, filePath ? path.basename(filePath) : "")
            .replace(/\$\{workspaceFolder\}/g, folderPath)
            .replace(/\$\{cwd\}/g, folderPath)
            .replace(/\$\{extensionPath\}/g, extensionPath || "")
            .replace(/\$\{config:([^}]+)\}/g, (_, key) => {
                const configValue = workspaceConfig.get(key);
                return configValue === undefined ? "" : String(configValue);
            });
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

function getIcemanConfiguration(folder, editor) {
    const config = vscode.workspace.getConfiguration("gdbScriptRunner.iceman", folder && folder.uri);

    return {
        enabled: config.get("enabled", false),
        executable: expandConfigValue(config.get("executable", "iceman"), editor, folder),
        args: expandConfigValue(config.get("args", []), editor, folder),
        cwd: expandConfigValue(config.get("cwd", "${workspaceFolder}"), editor, folder),
        andesRoot: expandConfigValue(config.get("andesRoot", ""), editor, folder),
        useAndesEnvironment: config.get("useAndesEnvironment", false),
        startupDelayMs: config.get("startupDelayMs", 1000)
    };
}

function trimTrailingSeparators(value) {
    return value.replace(/[\\/]+$/, "");
}

function ensureTrailingSeparator(value) {
    return value.endsWith(path.sep) ? value : `${value}${path.sep}`;
}

function getPathEnvKey(env) {
    return Object.keys(env).find((key) => key.toUpperCase() === "PATH") || "PATH";
}

function getAndesPaths(icemanConfig) {
    const andesRoot = trimTrailingSeparators(icemanConfig.andesRoot || "");

    if (!andesRoot) {
        return undefined;
    }

    const home = path.join(andesRoot, "ice");
    const cygwinBin = path.join(andesRoot, "cygwin", "bin");

    return {
        andesRoot,
        home,
        homeForEnv: ensureTrailingSeparator(home),
        cygwinBin,
        bashPath: path.join(cygwinBin, "bash.exe")
    };
}

function buildIcemanEnvironment(icemanConfig, andesPaths) {
    const env = { ...process.env };

    if (!icemanConfig.useAndesEnvironment) {
        return env;
    }

    if (!andesPaths) {
        return env;
    }

    const pathKey = getPathEnvKey(env);

    env.HOME = andesPaths.homeForEnv;
    env[pathKey] = `${andesPaths.cygwinBin};${andesPaths.homeForEnv};${env[pathKey] || ""}`;
    env.CYGPATH = "cygpath";

    if (fs.existsSync(andesPaths.bashPath)) {
        env.SHELL = "/bin/bash";
    }

    return env;
}

function quoteCmdArg(value) {
    return `"${String(value).replace(/"/g, '""')}"`;
}

function quoteBashString(value) {
    return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function buildCmdCommand(executable, args) {
    return [quoteCmdArg(executable), ...args.map(quoteCmdArg)].join(" ");
}

function buildBashIcemanCommand(executable, args) {
    const executableCommand = `"$(cygpath -u ${quoteBashString(executable)})"`;
    const quotedArgs = args.map(quoteBashString);

    return [executableCommand, ...quotedArgs].join(" ");
}

function normalizeIcemanArgs(args) {
    if (Array.isArray(args)) {
        return args.map((arg) => String(arg));
    }

    if (typeof args === "string" && args.trim().length > 0) {
        return args.trim().split(/\s+/);
    }

    return [];
}

async function startIceman(folder, editor, showAlreadyRunningMessage = false) {
    if (icemanTerminal) {
        if (showAlreadyRunningMessage) {
            vscode.window.showInformationMessage("Andes ICEman is already running.");
        }

        return true;
    }

    const icemanConfig = getIcemanConfiguration(folder, editor);
    const executable = icemanConfig.executable && String(icemanConfig.executable).trim();

    if (!executable) {
        vscode.window.showErrorMessage("Andes ICEman executable path is empty.");
        return false;
    }

    const args = normalizeIcemanArgs(icemanConfig.args);
    const cwd = icemanConfig.cwd || (folder && folder.uri.fsPath);
    const andesPaths = getAndesPaths(icemanConfig);
    const env = buildIcemanEnvironment(icemanConfig, andesPaths);

    if (icemanConfig.useAndesEnvironment && (!andesPaths || !fs.existsSync(andesPaths.bashPath))) {
        vscode.window.showErrorMessage("Andes Cygwin bash.exe was not found. Check gdbScriptRunner.iceman.andesRoot.");
        return false;
    }

    const terminalOptions = {
        name: "Andes ICEman",
        cwd,
        env
    };

    let command;

    if (icemanConfig.useAndesEnvironment) {
        terminalOptions.shellPath = andesPaths.bashPath;
        terminalOptions.shellArgs = ["--login", "-i"];
        command = buildBashIcemanCommand(executable, args);
    } else {
        terminalOptions.shellPath = process.env.ComSpec || "cmd.exe";
        command = buildCmdCommand(executable, args);
    }

    icemanTerminal = vscode.window.createTerminal(terminalOptions);
    icemanTerminal.show(true);
    icemanTerminal.sendText(command, true);

    if (icemanConfig.startupDelayMs > 0) {
        await delay(icemanConfig.startupDelayMs);
    }

    return true;
}

function stopIceman(showMessage = true) {
    if (!icemanTerminal) {
        if (showMessage) {
            vscode.window.showInformationMessage("Andes ICEman is not running.");
        }

        return;
    }

    const terminalToStop = icemanTerminal;
    icemanTerminal = undefined;
    terminalToStop.dispose();

    if (showMessage) {
        vscode.window.showInformationMessage("Stopped Andes ICEman.");
    }
}

function getDebugConfiguration(folder, editor) {
    const launch = vscode.workspace.getConfiguration("launch", folder.uri);
    const configurations = launch.get("configurations", []);

    const selectedName = vscode.workspace.getConfiguration("debug").get("selectedConfiguration");
    const baseConfig =
        configurations.find((config) => config.name === selectedName) ||
        configurations.find((config) => config.name === "CDT GDB Target: run script file") ||
        configurations.find((config) => config.name === "GDB-Multiarch: run script file") ||
        configurations[0];

    if (!baseConfig) {
        return undefined;
    }

    return expandConfigValue(baseConfig, editor, folder);
}

async function activate(context) {
    extensionPath = context.extensionPath;

    if (vscode.workspace.workspaceFolders) {
        for (const folder of vscode.workspace.workspaceFolders) {
            await ensureLaunchJson(context, folder);
        }
    }

    const startIcemanDisposable = vscode.commands.registerCommand("gdbScript.startIceman", async () => {
        const editor = vscode.window.activeTextEditor;
        const folder = getWorkspaceFolderForCommand(editor);

        if (!folder) {
            vscode.window.showErrorMessage("Open a workspace folder before starting Andes ICEman.");
            return;
        }

        await startIceman(folder, editor, true);
    });

    const stopIcemanDisposable = vscode.commands.registerCommand("gdbScript.stopIceman", () => {
        stopIceman(true);
    });

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

        const icemanConfig = getIcemanConfiguration(folder, editor);
        if (icemanConfig.enabled) {
            const started = await startIceman(folder, editor);

            if (!started) {
                return;
            }
        }

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

    const closeTerminalDisposable = vscode.window.onDidCloseTerminal((terminal) => {
        if (terminal === icemanTerminal) {
            icemanTerminal = undefined;
        }
    });

    context.subscriptions.push(
        disposable,
        startIcemanDisposable,
        stopIcemanDisposable,
        startDisposable,
        terminateDisposable,
        closeTerminalDisposable,
        {
            dispose: () => {
                stopTail();
                stopIceman(false);
            }
        }
    );
}

function deactivate() {
    stopTail();
    stopIceman(false);

    if (outputChannel) {
        outputChannel.dispose();
        outputChannel = undefined;
    }
}

module.exports = {
    activate,
    deactivate
};
