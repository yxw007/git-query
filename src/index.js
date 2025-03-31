#!/usr/bin/env node

import { exec } from "child_process";
import { Command } from "commander";
import path from "path";
import { fileURLToPath } from "url";
import moment from "moment";
import { logger, parseTime, writeFile, MatchType, ChangeType } from "./utils.js";
import reporter from "./exporter.js";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pkg = require("../package.json");

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const program = new Command();
program
  .name("git-query")
  .description(pkg.description)
  .version(pkg.version, "-v, --version")
  .requiredOption("-s, --since <date>", "Start time, Example: console:2025-01-01", (v) => parseTime("since", v), null)
  .option("-u, --until [date]", "deadlines, such as:2025-03-27", (v) => parseTime("until", v), moment().format("YYYY-MM-DD HH:mm:ss"))
  .option("-b, --branch [branch]", "Branch name, default current branch")
  .requiredOption("-r, --regex <pattern>", "Regular matching rules, Example: console\\.log")
  .option("-d, --debug [boolean]", "open debug output log", false)
  .option(
    "-t, --type [number]",
    "Match type: 0-file content match (default), 1-submission log match",
    (val) => {
      if (val === "0" || val === "1") {
        return val;
      }
      throw new Error(`type=${val} is invalid, the value must be 0 or 1`);
    },
    0,
  )
  .option(
    "-o, --output_report_dir [fileDir]",
    "The matching results are output to the absolute path directory, or to the current directory if not specified",
    (val) => {
      return path.isAbsolute(val) ? val : path.resolve(process.cwd(), val);
    },
    process.cwd(),
  )
  .addHelpText(
    "after",
    `
Notes:
  - Parameters enclosed in <> are required.
  - Parameters enclosed in [] are optional.

example:
  $ git-cr --s "2025-01-01" --u "2025-03-27" --b main --r "console\\.log" --t 0
  $ git-cr --since "1 week ago" --until "yesterday" --branch develop --regex "JIRA-\\d+" --type 1
`,
  );

program.parse(process.argv);

const options = program.opts();
const isDebug = !!options.debug ?? false;
options.type = parseInt(options.type);
logger.setDebugLogEnable(isDebug);

function getCommits(since, until, branch) {
  return new Promise((resolve, reject) => {
    const cmd = `git log ${branch} --since="${since}" --until="${until}" --pretty=format:"%H|%ci|%an|%s"`;
    logger.debug("`query git cmd:");
    logger.debug(cmd);

    exec(cmd, (error, stdout) => {
      if (error) {
        return reject(error);
      }
      // 每一行格式: commitId|timestamp|author|message
      const commits = stdout
        .split("\n")
        .filter((line) => line)
        .map((line) => {
          const parts = line.split("|");
          const id = parts[0];
          const timestamp = parts[1];
          const author = parts[2];
          // 后面的部分可能包含"|"，需要重新拼接
          const message = parts.slice(3).join("|");
          return { id, timestamp, author, message };
        });
      resolve(commits);
    });
  });
}

function getCommitDiff(commitId) {
  return new Promise((resolve, reject) => {
    const cmd = `git show ${commitId}`;
    exec(cmd, (error, stdout) => {
      if (error) {
        return reject(error);
      }
      resolve(stdout);
    });
  });
}

function parseDiff(diffText, regex) {
  const matchedFiles = [];
  let currentFile = null;
  const lines = diffText.split("\n");
  let addCurLineNum = null;
  let removeCurLineNum = null;
  for (let line of lines) {
    // 检查 diff 文件标识，一般以 'diff --git a/filepath b/filepath' 开始
    if (line.startsWith("diff --git")) {
      if (currentFile) {
        matchedFiles.push(currentFile);
      }
      const fileMatch = line.match(/ b\/(.+)$/);
      currentFile = fileMatch ? { filename: fileMatch[1], changes: [] } : null;
      continue;
    }
    // 基于 diff hunk 开始行的标识
    // 例如 @@ -start,count +start,count @@
    let hunkMatch = line.match(/^@@\s\-(\d+),(\d+).*? @@/);
    if (hunkMatch) {
      addCurLineNum = removeCurLineNum = parseInt(hunkMatch[1]);
    } else {
      if (addCurLineNum != null && /^((\+)|[^\-]).*/.test(line)) {
        ++addCurLineNum;
      }
      if (removeCurLineNum != null && /^((\-)|[^\+]).*/.test(line)) {
        ++removeCurLineNum;
      }
    }

    if (currentFile && line.startsWith("+") && !line.startsWith("+++")) {
      // add line
      const content = line.substring(1); // 去除 '+'
      if (new RegExp(regex, "i").test(content)) {
        currentFile.changes.push({ lineNumber: addCurLineNum, content, changeType: ChangeType.Add });
      }
    }

    if (currentFile && line.startsWith("-") && !line.startsWith("---")) {
      // remove line
      const content = line.substring(1); // 去除 '-'
      if (new RegExp(regex, "i").test(content)) {
        currentFile.changes.push({ lineNumber: removeCurLineNum, content, changeType: ChangeType.Remove });
      }
    }
  }
  if (currentFile) {
    matchedFiles.push(currentFile);
  }
  return matchedFiles;
}

function matchCommitMessage(commit, regex) {
  return new RegExp(regex).test(commit.message);
}

function commitHasChange(matches) {
  return matches.length > 0 && matches.some((m) => m.changes.length > 0);
}

async function checkBranchExist(branchName) {
  return new Promise((resolve, reject) => {
    exec("git rev-parse --is-inside-work-tree", async (error) => {
      if (error) {
        return reject(new Error("Current directory is not a Git repository"));
      }

      if (!branchName) {
        let res = await getCurrentBranchName();
        resolve(res);
      } else {
        exec(`git show-ref --verify --quiet refs/heads/${branchName}`, (branchError) => {
          if (branchError) {
            return reject(new Error(`Branch '${branchName}' does not exist in this repository`));
          }
          resolve();
        });
      }
    });
  });
}

async function getCurrentBranchName() {
  return new Promise((resolve, reject) => {
    exec("git rev-parse --abbrev-ref HEAD", (error, stdout) => {
      if (error) {
        return reject(error);
      }
      resolve(stdout.trim());
    });
  });
}

async function pickMatchChangeContentRecords({ commit, matches, reporter }) {
  reporter.addRecord("");
  reporter.addRecord(`Commit: ${commit.id}  |  Time: ${commit.timestamp}  |  Author: ${commit.author}`);
  reporter.addRecord(`    Message: ${commit.message}`);
  matches.forEach((file) => {
    if (file.changes.length > 0) {
      reporter.addRecord(`    FileName: ${file.filename} , MatchCount: ${file.changes.length}`);
      file.changes.forEach((change) => {
        reporter.addRecord(`        LineNumber: ${change.lineNumber} | ChangeType: ${change.changeType} |  Content: ${change.content}`);
      });
    }
  });
}

async function pickMatchMessageRecords({ commit, reporter }) {
  reporter.addRecord(`Commit: ${commit.id}  |  Time: ${commit.timestamp}  |  Author: ${commit.author}`);
  reporter.addRecord(`    Message: ${commit.message}`);
  reporter.addRecord("");
}

async function run() {
  try {
    let branchName = await checkBranchExist(options.branch);
    options.branch = branchName;

    const commits = await getCommits(options.since, options.until, options.branch);
    if (commits.length === 0) {
      logger.log("No submission records were found that met the time and branch criteria");
      return;
    }

    let matchesFound = 0;
    for (let commit of commits) {
      if (options.type === MatchType.MESSAGE_CONTENT) {
        if (matchCommitMessage(commit, options.regex)) {
          pickMatchMessageRecords({ commit, reporter });
          matchesFound++;
        }
      } else {
        // File content matching mode (default)
        const diffText = await getCommitDiff(commit.id);
        const matches = parseDiff(diffText, options.regex);
        if (commitHasChange(matches)) {
          if (isDebug) {
            writeFile(path.resolve(__dirname, `../assets/${commit.id}.txt`), diffText);
          }

          pickMatchChangeContentRecords({ commit, matches, reporter });
          matchesFound++;
        }
      }
    }

    if (reporter.hasRecord()) {
      const { filePath, content } = reporter.renderToNative(options.output_report_dir);
      logger.log(`${options.branch} branch found ${matchesFound} matching submissions, report output directory: ${filePath}`);
      logger.debug(content);
    } else {
      logger.log(`${options.branch} branch couldn't find any matches`);
      process.exit(-1);
    }
  } catch (error) {
    logger.error(error);
    process.exit(1);
  }
}

run();
