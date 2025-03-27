#!/usr/bin/env node

const { exec } = require('child_process');
const { Command } = require('commander');
const program = new Command();

// 配置命令行参数
program
	.name('git-filter')
	.description('一个 Git 提交记录过滤工具，可以搜索匹配的内容')
	.version('1.0.0')
	.requiredOption('--since <date>', '开始时间，例如：2025-01-01')
	.requiredOption('--until <date>', '截止时间，例如：2025-03-27')
	.requiredOption('--branch <branch>', '分支名，例如：main')
	.requiredOption('--regex <pattern>', '正则匹配规则，例如：console\\.log')
	.option('--type <number>', '匹配类型：0-文件内容匹配(默认)，1-提交日志匹配', '0')
	.addHelpText('after', `
示例:
  $ git-filter --since "2025-01-01" --until "2025-03-27" --branch main --regex "console\\.log" --type 0
  $ git-filter --since "1 week ago" --until "yesterday" --branch develop --regex "JIRA-\\d+" --type 1
`);

program.parse(process.argv);

const options = program.opts();
// 将type转为数字
options.type = parseInt(options.type);

// 获取 commit 列表
function getCommits(since, until, branch) {
	return new Promise((resolve, reject) => {
		// 更新格式字符串，添加提交消息
		const cmd = `git log ${branch} --since="${since}" --until="${until}" --pretty=format:"%H|%ct|%an|%s"`;
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

// 获取 commit 的 diff 信息
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

// 解析 diff 输出，匹配正则并收集信息
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
		if (hunkMatch && currentLineNumber === null) {
			currentLineNumber = parseInt(hunkMatch[1]);
		}

		if (currentFile && line.startsWith('+') && !line.startsWith('+++')) {
			// line 被添加的行
			const content = line.substring(1); // 去除 '+'
			if (new RegExp(regex).test(content)) {
				currentFile.changes.push({ lineNumber: currentLineNumber, content });
			}
			if (currentLineNumber !== null) {
				currentLineNumber++;
			}
		}
	}
	if (currentFile) {
		matchedFiles.push(currentFile);
	}
	return matchedFiles;
}

// 检查提交消息是否匹配正则表达式
function matchCommitMessage(commit, regex) {
	return new RegExp(regex).test(commit.message);
}

function commitHasChange(matches) {
	return matches.length > 0 && matches.some(m => m.changes.length > 0);
}

async function run() {
	try {
		const commits = await getCommits(options.since, options.until, options.branch);

		if (commits.length === 0) {
			console.log('未找到符合时间和分支条件的提交记录');
			return;
		}

		let matchesFound = 0;

		for (let commit of commits) {
			// 根据匹配类型执行不同的匹配逻辑
			if (options.type === 1) {
				// 提交日志匹配模式
				if (matchCommitMessage(commit, options.regex)) {
					console.log(`Commit: ${commit.id}    时间: ${new Date(commit.timestamp * 1000).toLocaleString()}    作者: ${commit.author}`);
					console.log(`    提交信息: ${commit.message}`);
					console.log('');
					matchesFound++;
				}
			} else {
				// 文件内容匹配模式 (默认)
				const diffText = await getCommitDiff(commit.id);
				const matches = parseDiff(diffText, options.regex);
				if (commitHasChange(matches)) {
					console.log(`Commit: ${commit.id}    时间: ${new Date(commit.timestamp * 1000).toLocaleString()}    作者: ${commit.author}`);
					console.log(`    提交信息: ${commit.message}`);
					matches.forEach(file => {
						if (file.changes.length > 0) {
							console.log(`    文件: ${file.filename}`);
							file.changes.forEach(change => {
								console.log(`        行号: ${change.lineNumber}    内容: ${change.content}`);
							});
						}
					});
					console.log('');
					matchesFound++;
				}
			}
		}

		if (matchesFound === 0) {
			console.log('未找到符合匹配条件的内容');
		} else {
			console.log(`共找到 ${matchesFound} 个匹配的提交`);
		}
	} catch (error) {
		console.error('错误：', error);
		process.exit(1);
	}
}

run();
