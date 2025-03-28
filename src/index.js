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
  .name("git-filter")
  .description("A git commit history filtering tool that can search for matches")
  .version(pkg.version)
  .requiredOption("--since <date>", "Start time, Example: console:2025-01-01", (v) => parseTime("since", v), null)
  .option("--until <date>", "deadlines, such as:2025-03-27", (v) => parseTime("until", v), moment().format("YYYY-MM-DD HH:mm:ss"))
  .requiredOption("--branch <branch>", "Branch name, Example: console: master")
  .requiredOption("--regex <pattern>", "Regular matching rules, Example: console\\.log")
  .option("--debug", "open debug output log", false)
  .option(
    "--type <number>",
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
    "--output_report_dir <fileDir>",
    "Which directory will the matching content be output to, If not specified, it will be exported to the current directory",
    (val) => {
      return path.isAbsolute(val) ? val : path.resolve(process.cwd(), val);
    },
    process.cwd(),
  )
  .addHelpText(
    "after",
    `
example:
  $ git-filter --since "2025-01-01" --until "2025-03-27" --branch main --regex "console\\.log" --type 0
  $ git-filter --since "1 week ago" --until "yesterday" --branch develop --regex "JIRA-\\d+" --type 1
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
    }

    if (currentFile && line.startsWith("+") && !line.startsWith("+++")) {
      // add line
      const content = line.substring(1); // 去除 '+'
      if (new RegExp(regex).test(content)) {
        currentFile.changes.push({ lineNumber: addCurLineNum, content, changeType: ChangeType.Add });
      }
    }

    if (currentFile && line.startsWith("-") && !line.startsWith("---")) {
      // remove line
      const content = line.substring(1); // 去除 '-'
      if (new RegExp(regex).test(content)) {
        currentFile.changes.push({ lineNumber: removeCurLineNum, content, changeType: ChangeType.Remove });
      }
    }

    if (addCurLineNum != null && !line.startsWith("+")) {
      addCurLineNum++;
    }
    if (removeCurLineNum != null && !line.startsWith("-")) {
      removeCurLineNum++;
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
    exec("git rev-parse --is-inside-work-tree", (error) => {
      if (error) {
        return reject(new Error("Current directory is not a Git repository"));
      }

      exec(`git show-ref --verify --quiet refs/heads/${branchName}`, (branchError) => {
        if (branchError) {
          return reject(new Error(`Branch '${branchName}' does not exist in this repository`));
        }
        resolve();
      });
    });
  });
}

async function pickMatchChangeContentRecords({ commit, matches, reporter }) {
  reporter.addRecord("");
  reporter.addRecord(`Commit: ${commit.id}  |  Time: ${commit.timestamp}  |  Author: ${commit.author}`);
  reporter.addRecord(`    Message: ${commit.message}`);
  matches.forEach((file) => {
    if (file.changes.length > 0) {
      reporter.addRecord(`    filename: ${file.filename}`);
      file.changes.forEach((change) => {
        reporter.addRecord(`        line number: ${change.lineNumber} | change type: ${change.changeType} |  content: ${change.content}`);
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
    await checkBranchExist(options.branch);

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
        if (isDebug) {
          writeFile(path.resolve(__dirname, `../assets/${commit.id}.txt`), diffText);
        }
        const matches = parseDiff(diffText, options.regex);
        if (commitHasChange(matches)) {
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
