# git-query

A command-line git record query CI tool that allows you to easily query git commit records and file change records

## Install

```bash
npm install @yxw007/git-query -g
```

## Help

```bash
Usage: git-query [options]

A git commit history query tool that can search for matches

Options:
  -v, --version                      output the version number
  -s, --since <date>                 Start time, Example: console:2025-01-01 (default: null)
  -u, --until [date]                 deadlines, such as:2025-03-27 (default: "2025-03-31 15:43:43")
  -b, --branch [branch]              Branch name, default current branch
  -r, --regex <pattern>              Regular matching rules, Example: console\.log
  -d, --debug [boolean]              open debug output log (default: false)
  -t, --type [number]                Match type: 0-file content match (default), 1-submission log match (default: 0)
  -o, --output_report_dir [fileDir]  The matching results are output to the absolute path directory, or to the current directory if not specified (default:
                                     "D:\\projects\\git-query")
  -h, --help                         display help for command

Notes:
  - Parameters enclosed in <> are required.
  - Parameters enclosed in [] are optional.

example:
  $ git-query --s "2025-01-01" --u "2025-03-27" --b main --r "console\.log" --t 0
  $ git-query --since "1 week ago" --until "yesterday" --branch develop --regex "JIRA-\d+" --type 1

```
