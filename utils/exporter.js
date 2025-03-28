import { writeFile } from "./index.js";

class Reporter {
	records = [];
	name = "";
	constructor(name = "gitMatchRecord") {
		this.name = name;
	}
	addRecord(record) {
		this.records.push(record);
	}
	hasRecord() {
		return this.records.length > 0;
	}
	render() {
		return this.records.join("\n");
	}
	getReportFilePath() {

	}
	renderToNative(outputDir) {
		let content = this.render();
		let filePath = `${outputDir}/${this.name}.txt`;
		writeFile(filePath, content);
		return { content, filePath }
	}
}

const reporter = new Reporter();

export default reporter;
