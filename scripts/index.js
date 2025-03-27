#!/usr/bin/env node

import { exec } from 'child_process';
import { Command } from 'commander';
import path from "path";
import { fileURLToPath } from "url"
import moment from 'moment';
import { logger, parseTime, writeFile, MatchType } from "../utils/index.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const program = new Command();
program
	.name('git-filter')
	.description('A git commit history filtering tool that can search for matches')
	.version('1.0.0')
	.requiredOption('--since <date>', 'Start time, Example：console:2025-01-01', (v) => parseTime("since", v), null)
	.option('--until <date>', 'deadlines, such as:2025-03-27', (v) => parseTime("until", v), moment().format('YYYY-MM-DD HH:mm:ss'))
	.requiredOption('--branch <branch>', 'Branch name, Example：console: master')
	.requiredOption('--regex <pattern>', 'Regular matching rules, Example：console\\.log')
	.option('--debug', "open debug output log", false)
	.option('--type <number>', 'Match type: 0-file content match (default), 1-submission log match', (val) => {
		if (val === "0" || val === "1") {
			return val;
		}
		throw new Error(`type=${val} is invalid, the value must be 0 or 1`);
	}, 0)
	.addHelpText('after', `
example:
  $ git-filter --since "2025-01-01" --until "2025-03-27" --branch main --regex "console\\.log" --type 0
  $ git-filter --since "1 week ago" --until "yesterday" --branch develop --regex "JIRA-\\d+" --type 1
`);

program.parse(process.argv);

const options = program.opts();
options.type = parseInt(options.type);
logger.setDebugLogEnable(!!options.debug ?? false);

function getCommits(since, until, branch) {
	return new Promise((resolve, reject) => {
		const cmd = `git log ${branch} --since="${since}" --until="${until}" --pretty=format:"%H|%ci|%an|%s"`;
		logger.log("`query git cmd:");
		logger.log(cmd);

		exec(cmd, (error, stdout) => {
			if (error) {
				return reject(error);
			}
			// 每一行格式： commitId|timestamp|author|message
			const commits = stdout.split('\n').filter(line => line).map(line => {
				const parts = line.split('|');
				const id = parts[0];
				const timestamp = parts[1];
				const author = parts[2];
				// 后面的部分可能包含"|"，需要重新拼接
				const message = parts.slice(3).join('|');
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
	const lines = diffText.split('\n');
	let currentLineNumber = null;
	for (let line of lines) {
		// 检查 diff 文件标识，一般以 'diff --git a/filepath b/filepath' 开始
		if (line.startsWith('diff --git')) {
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
			currentLineNumber = parseInt(hunkMatch[1]);
		}

		// console.log(`-------------currentLineNumber:${currentLineNumber},line:${line}---------------------`);

		if (currentFile && line.startsWith('+') && !line.startsWith('+++')) {
			// line 被添加的行
			const content = line.substring(1); // 去除 '+'
			if (new RegExp(regex).test(content)) {
				currentFile.changes.push({ lineNumber: currentLineNumber, content });
			}
		}
		if (currentLineNumber != null) {
			if (!line.startsWith('-')) {
				currentLineNumber++;
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
	return matches.length > 0 && matches.some(m => m.changes.length > 0);
}

async function checkBranchExist(branchName) {
	return new Promise((resolve, reject) => {
		exec('git rev-parse --is-inside-work-tree', (error) => {
			if (error) {
				return reject(new Error('Current directory is not a Git repository'));
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

async function run() {
	try {
		await checkBranchExist(options.branch);

		const commits = await getCommits(options.since, options.until, options.branch);

		if (commits.length === 0) {
			logger.log('No submission records were found that met the time and branch criteria');
			return;
		}

		let matchesFound = 0;

		for (let commit of commits) {
			if (options.type === MatchType.MESSAGE_CONTENT) {
				if (matchCommitMessage(commit, options.regex)) {
					logger.log(`Commit: ${commit.id}    Time: ${commit.timestamp}    Author: ${commit.author}`);
					logger.log(`    Message: ${commit.message}`);
					logger.log('');
					matchesFound++;
				}
			} else {
				// 文件内容匹配模式 (默认)
				const diffText = await getCommitDiff(commit.id);
				writeFile(path.resolve(__dirname, `../assets/${commit.id}.txt`), diffText);
				const matches = parseDiff(diffText, options.regex);
				if (commitHasChange(matches)) {
					logger.log(`Commit: ${commit.id}    Time: ${commit.timestamp}    Author: ${commit.author}`);
					logger.log(`    Message: ${commit.message}`);
					matches.forEach(file => {
						if (file.changes.length > 0) {
							logger.log(`    filename: ${file.filename}`);
							file.changes.forEach(change => {
								logger.log(`        line number: ${change.lineNumber}    content: ${change.content}`);
							});
						}
					});
					logger.log('');
					matchesFound++;
				}
			}
		}

		if (matchesFound === 0) {
			logger.log(`${options.branch} branch couldn't find any matches`);
		} else {
			logger.log(`${options.branch} branch found ${matchesFound} matching submissions`);
		}
	} catch (error) {
		logger.error(error);
		process.exit(1);
	}
}

run();
