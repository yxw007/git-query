# git-query

A command-line git record query CI tool that allows you to easily query git commit records and file change records

## Install

```bash
npm install @yxw007/git-query -g
```

## Help

Usage: git-filter [options]

A git commit history filtering tool that can search for matches

Options:
  -V, --version                  output the version number
  --since <date>                 Start time, Example: console:2025-01-01 (default: null)
  --until <date>                 deadlines, such as:2025-03-27 (default: "2025-03-28 12:23:14")
  --branch <branch>              Branch name, Example: console: master
  --regex <pattern>              Regular matching rules, Example: console\.log
  --debug                        open debug output log (default: false)
  --type <number>                Match type: 0-file content match (default), 1-submission log match (default: 0)
  --output_report_dir <fileDir>  Which directory will the matching content be output to, If not specified, it will be exported to the  
                                 current directory (default: "D:\\projects\\git-query")
  -h, --help                     display help for command

example:
  $ git-filter --since "2025-01-01" --until "2025-03-27" --branch main --regex "console\.log" --type 0
  $ git-filter --since "1 week ago" --until "yesterday" --branch develop --regex "JIRA-\d+" --type 1