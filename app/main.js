const readline = require("readline");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { homedir } = require("os");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  completer: (() => {
    let lastLine = "";
    let lastMatches = [];
    let tabPressCount = 0;

    return (line) => {
      const builtins = ["echo", "exit"];

      let matches = builtins.filter((cmd) => cmd.startsWith(line));

      const pathDirs = process.env.PATH.split(":");
      let executables = [];
      for (const dir of pathDirs) {
        try {
          const files = fs.readdirSync(dir);
          executables.push(...files);
        } catch {}
      }
      executables = executables.filter((name) => name.startsWith(line));

      matches = [...matches, ...executables];
      matches = [...new Set(matches)].sort();

      if (matches.length === 0) {
        process.stdout.write("\x07");
        lastLine = line;
        lastMatches = [];
        tabPressCount = 0;
        return [[], line];
      } else if (matches.length === 1) {
        lastLine = line;
        lastMatches = [];
        tabPressCount = 0;
        return [[matches[0] + " "], line];
      } else {
        if (line === lastLine && tabPressCount === 1) {
          console.log("\n" + matches.join("  "));
          tabPressCount = 0;
          rl.prompt();
        } else {
          process.stdout.write("\x07");
          tabPressCount = 1;
        }
        lastLine = line;
        lastMatches = matches;
        return [matches, line];
      }
    };
  })(),
});
const history = [];
let historySavedCount = 0;
const builtins = ["echo", "type", "exit", "history", "pwd"];
const histfile = process.env.HISTFILE;

if (histfile && fs.existsSync(histfile)) {
  try {
    const data = fs.readFileSync(histfile, "utf-8");
    const lines = data.split("\n").filter((line) => line.trim() !== "");
    history.push(...lines);
    historySavedCount = history.length;
  } catch (err) {
    console.error(`history: cannot read history file '${histfile}'`);
  }
}

function findExecutable(cmd) {
  const pathDirs = process.env.PATH.split(path.delimiter);
  for (let dir of pathDirs) {
    const fullPath = path.join(dir, cmd);
    if (fs.existsSync(fullPath)) {
      try {
        fs.accessSync(fullPath, fs.constants.X_OK);
        return fullPath;
        break;
      } catch {
        continue;
      }
    }
  }
  return null;
}

function saveHistory(cmd) {
  history.push(cmd);
}

function fileHistory(filePath) {
  try {
    const data = fs.readFileSync(filePath, "utf-8");

    const lines = data
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    lines.forEach((line) => history.push(line));
  } catch (err) {
    console.error(`history: cannot read file '${filePath}'`);
  }
}
function writeHistory(commands, filePath) {
  try {
    const data = commands.join("\n") + "\n";
    fs.writeFileSync(filePath, data, "utf-8");
    historySavedCount = history.length;
  } catch (err) {
    console.error(`history: cannot write to file '${filePath}'`);
  }
}

function appendHistory(commands, filePath) {
  try {
    const total = history.length;
    const newEntries = history.slice(historySavedCount);

    if (newEntries.length === 0) {
      return;
    }

    const data = newEntries.join("\n") + "\n";
    fs.appendFileSync(filePath, data, "utf-8");
    historySavedCount = total;
  } catch (err) {
    console.error(`history: cannot append to file '${filePath}'`);
  }
}
function parseCommand(command) {
  const args = [];
  let current = "";
  let inQuote = null;
  let escape = false;

  for (let i = 0; i < command.length; i++) {
    const char = command[i];

    if (!inQuote && !escape && char === "\\") {
      escape = true;
      continue;
    }

    if (escape) {
      current += char;
      escape = false;
      continue;
    }
    if (inQuote === '"') {
      if (char === "\\" && i + 1 < command.length) {
        const next = command[i + 1];
        if (next === '"' || next === "\\") {
          current += next;
          i++;
          continue;
        }
      }
    }

    if (!escape && (char === "'" || char === '"') && inQuote === null) {
      inQuote = char;
      continue;
    }

    if (!escape && char === inQuote) {
      inQuote = null;
      continue;
    }

    if (!inQuote && /\s/.test(char)) {
      if (current !== "") {
        args.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current !== "") args.push(current);
  return args;
}

function prompt() {
  rl.question("$ ", (line) => {
    const command = (line || "").trim();

    if (!command) {
      prompt();
      return;
    }

    saveHistory(command);

    const tokens = parseCommand(command);
    const [cmd0, ...rawArgs] = tokens;
    const cmd = cmd0 || "";
    let args = [...rawArgs];

    let redirectOut = null;
    let redirectErr = null;
    let appendOut = false;
    let appendErr = false;

    for (let i = 0; i < args.length; i++) {
      const t = args[i];
      if ((t === ">" || t === "1>") && i + 1 < args.length) {
        redirectOut = args[i + 1];
        appendOut = false;
        args.splice(i, 2);
        i--;
        continue;
      }
      if ((t === ">>" || t === "1>>") && i + 1 < args.length) {
        redirectOut = args[i + 1];
        appendOut = true;
        args.splice(i, 2);
        i--;
        continue;
      }
      if (t === "2>" && i + 1 < args.length) {
        redirectErr = args[i + 1];
        appendErr = false;
        args.splice(i, 2);
        i--;
        continue;
      }
      if (t === "2>>" && i + 1 < args.length) {
        redirectErr = args[i + 1];
        appendErr = true;
        args.splice(i, 2);
        i--;
        continue;
      }
    }

    function openFdIf(pathname, isAppend) {
      if (!pathname) return "inherit";
      try {
        const flag = isAppend ? "a" : "w";
        return fs.openSync(pathname, flag);
      } catch (e) {
        process.stderr.write(`shell: cannot open '${pathname}'\n`);
        return "inherit";
      }
    }

    if (command.includes("|")) {
      const parts = command.split("|").map((s) => s.trim());
      const procs = [];
      for (let i = 0; i < parts.length; i++) {
        const segTokens = parseCommand(parts[i]);
        const [scmd, ...sargs] = segTokens;

        if (builtins.includes(scmd)) {
          const { PassThrough } = require("stream");
          const inStream = new PassThrough();
          const outStream = new PassThrough();

          if (scmd === "echo") {
            outStream.end(sargs.join(" ") + "\n");
          } else if (scmd === "type") {
            const target = sargs[0];
            if (builtins.includes(target)) {
              outStream.end(`${target} is a shell builtin\n`);
            } else {
              const p = findExecutable(target);
              outStream.end(
                p ? `${target} is ${p}\n` : `${target}: not found\n`
              );
            }
          } else {
            outStream.end("");
          }

          if (i > 0) {
            const prev = procs[i - 1];
            if (prev.stdout && inStream) prev.stdout.pipe(inStream);
          }

          procs.push({ stdout: outStream });
          if (i === parts.length - 1) {
            if (redirectOut) {
              const fd = openFdIf(redirectOut, appendOut);
              outStream.pipe(
                fs.createWriteStream(null, { fd, autoClose: false })
              );
            } else {
              outStream.pipe(process.stdout);
            }
            if (redirectErr) {
              try {
                fs.closeSync(fs.openSync(redirectErr, appendErr ? "a" : "w"));
              } catch {}
            }
            outStream.on("end", () => prompt());
          }

          continue;
        }

        const full = findExecutable(scmd);
        if (!full) {
          console.log(`${scmd}: command not found`);
          prompt();
          return;
        }

        let stdioCfg;
        if (i === 0) stdioCfg = ["inherit", "pipe", "inherit"];
        else if (i === parts.length - 1) {
          stdioCfg = ["pipe", "inherit", "inherit"];
        } else stdioCfg = ["pipe", "pipe", "inherit"];

        const child = spawn(full, sargs, { stdio: stdioCfg, argv0: scmd });
        procs.push(child);

        if (i > 0) {
          const prev = procs[i - 1];
          if (prev.stdout && child.stdin) prev.stdout.pipe(child.stdin);
        }

        if (i === parts.length - 1) {
          if (redirectOut) {
            const fd = openFdIf(redirectOut, appendOut);
            if (child.stdout) {
              child.stdout.pipe(
                fs.createWriteStream(null, { fd, autoClose: false })
              );
            }
          } else {
            if (child.stdout) child.stdout.pipe(process.stdout);
          }
          if (redirectErr) {
            if (child.stderr) {
              const fdErr = openFdIf(redirectErr, appendErr);
              child.stderr.pipe(
                fs.createWriteStream(null, { fd: fdErr, autoClose: false })
              );
            } else {
            }
          }

          child.on("close", () => {
            prompt();
          });
        }
      }

      return;
    }

    if (cmd === "exit" && args[0] === "0") {
      if (histfile) {
        try {
          fs.writeFileSync(histfile, history.join("\n") + "\n");
        } catch (err) {
          console.error(`history: cannot write history file '${histfile}'`);
        }
      }
      rl.close();
      return;
    }

    if (cmd === "pwd") {
      console.log(process.cwd());
      prompt();
      return;
    }

    if (cmd === "cd") {
      let target = args[0];
      if (!target) {
        console.log("cd: missing argument");
        prompt();
        return;
      }
      if (target === "~") target = os.homedir();
      if (!path.isAbsolute(target))
        target = path.resolve(process.cwd(), target);

      try {
        if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
          process.chdir(target);
        } else {
          console.log(`cd: ${args[0]}: No such file or directory`);
        }
      } catch {
        console.log(`cd: ${args[0]}: No such file or directory`);
      }
      prompt();
      return;
    }

    if (cmd === "echo") {
      const outText = args.join(" ") + "\n";
      if (redirectErr) {
        try {
          fs.closeSync(fs.openSync(redirectErr, appendErr ? "a" : "w"));
        } catch (e) {}
      }
      if (redirectOut) {
        const fdOut = openFdIf(redirectOut, appendOut);
        if (fdOut !== "inherit") {
          fs.writeSync(fdOut, outText);
          try {
            fs.closeSync(fdOut);
          } catch {}
        } else process.stdout.write(outText);
      } else {
        process.stdout.write(outText);
      }
      prompt();
      return;
    }

    if (cmd === "cat") {
      let fdOut = null;
      if (redirectOut) fdOut = openFdIf(redirectOut, appendOut);

      for (const f of args) {
        try {
          const data = fs.readFileSync(f, "utf-8");
          if (fdOut !== null && fdOut !== "inherit") {
            fs.writeSync(fdOut, data);
          } else {
            process.stdout.write(data);
          }
        } catch (err) {
          const errMsg = `cat: ${f}: No such file or directory\n`;
          if (redirectErr) {
            const fdErr = openFdIf(redirectErr, appendErr);
            if (fdErr !== "inherit") {
              fs.writeSync(fdErr, errMsg);
              try {
                fs.closeSync(fdErr);
              } catch {}
            }
          } else {
            process.stderr.write(errMsg);
          }
        }
      }

      if (fdOut !== null && fdOut !== "inherit") {
        try {
          fs.closeSync(fdOut);
        } catch {}
      }
      prompt();
      return;
    }

    if (cmd === "type") {
      const target = args[0];
      if (builtins.includes(target)) {
        console.log(`${target} is a shell builtin`);
      } else {
        const p = findExecutable(target);
        if (p) console.log(`${target} is ${p}`);
        else console.log(`${target}: not found`);
      }
      prompt();
      return;
    }

    if (cmd === "history") {
      if (args[0] === "-r" && args[1]) {
        fileHistory(args[1]);
        prompt();
        return;
      }
      if (args[0] === "-w" && args[1]) {
        writeHistory(history, args[1]);
        prompt();
        return;
      }
      if (args[0] === "-a" && args[1]) {
        appendHistory(history, args[1]);
        prompt();
        return;
      }
      const n = args.length > 0 ? parseInt(args[0], 10) : null;
      const items = n ? history.slice(-n) : history;
      const start = history.length - items.length;
      items.forEach((entry, i) =>
        console.log(`    ${start + i + 1}  ${entry}`)
      );
      prompt();
      return;
    }

    const fullPath = findExecutable(cmd);
    if (!fullPath) {
      console.log(`${cmd}: command not found`);
      prompt();
      return;
    }

    const stdoutFd = redirectOut ? openFdIf(redirectOut, appendOut) : "inherit";
    const stderrFd = redirectErr ? openFdIf(redirectErr, appendErr) : "inherit";

    let stdioConfig;
    if (stdoutFd === "inherit" && stderrFd === "inherit") {
      stdioConfig = "inherit";
    } else {
      stdioConfig = ["inherit", stdoutFd, stderrFd];
    }

    const child = spawn(fullPath, args, { stdio: stdioConfig, argv0: cmd });

    child.on("exit", () => {
      try {
        if (typeof stdoutFd === "number") fs.closeSync(stdoutFd);
      } catch {}
      try {
        if (typeof stderrFd === "number") fs.closeSync(stderrFd);
      } catch {}
      prompt();
    });
  });
}
prompt();
