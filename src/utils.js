import moment from "moment";
import fs from "fs";
import path from "path";

export function parseTime(paramName, val) {
  try {
    return moment(val).format("YYYY-MM-DD HH:mm:ss");
  } catch (error) {
    throw new Error(`${paramName} is invalid !`);
  }
}

class Logger {
  isOpenDebug = false;
  constructor() {}
  log(...args) {
    console.log(...args);
  }
  debug(...args) {
    if (!this.isOpenDebug) {
      return;
    }
    console.debug(...args);
  }
  warn(...args) {
    console.warn(...args);
  }
  error(...args) {
    console.error(...args);
  }
  setDebugLogEnable(enable) {
    this.isOpenDebug = !!enable;
  }
}

export const logger = new Logger();

export function writeFile(filePath, content) {
  let dirPath = path.dirname(filePath);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  fs.writeFileSync(filePath, content, { encoding: "utf8" });
}

export const MatchType = {
  FILE_CHANGE_CONTENT: 0,
  MESSAGE_CONTENT: 1,
};

export const ChangeType = {
  Add: "ADD",
  Remove: "REMOVE",
};
