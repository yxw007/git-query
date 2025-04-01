import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const replaceAuthors = {
	"EASTPROLTD\\yan.xuewen <yan.xuewen@eabsystems.com>": "Potter<aa4790139@gmail.com>"
}

function run() {
	let matchAuthorReg = /(?<=### ❤️ Contributors)\n+((-\s.*)\n*)+/gm;

	let filePath = path.resolve(__dirname, "../CHANGELOG.md");
	let content = fs.readFileSync(filePath, { encoding: "utf8" });


	content = content.replace(matchAuthorReg, (matchedText, ...args) => {
		console.log("matchedText:", matchedText);
		if (!matchedText) {
			return;
		}
		let authors = matchedText.trim().split("-").filter(Boolean);
		let changeAuthors = authors.map((author) => {
			author = author.trim();
			if (!author || author.length == 0) {
				return author;
			}
			if (replaceAuthors[author]) {
				return `- ${replaceAuthors[author]}`
			} else {
				return `- ${author}`;
			}
		})

		return `\n\n${changeAuthors.join("\n")}`;
	})

	fs.writeFileSync(filePath, content);
}

run();
