const fs = require("fs");
const path = require("path");

const dirs = [
  "c:\\Users\\Sohan Rajawat\\OneDrive\\Desktop\\viramah\\Viramah-main",
  "c:\\Users\\Sohan Rajawat\\OneDrive\\Desktop\\viramah\\viramah-admin",
  "c:\\Users\\Sohan Rajawat\\OneDrive\\Desktop\\viramah\\viramah-backend"
];

function searchDir(dir, query) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    if (file === "node_modules" || file === ".next" || file === ".git") continue;
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      searchDir(filePath, query);
    } else if (stat.isFile() && (file.endsWith(".js") || file.endsWith(".ts") || file.endsWith(".tsx") || file.endsWith(".jsx") || file.endsWith(".html") || file.endsWith(".json"))) {
      const content = fs.readFileSync(filePath, "utf8");
      if (content.toLowerCase().includes(query.toLowerCase())) {
        console.log(`Found query "${query}" in: ${filePath}`);
        // print matching lines
        const lines = content.split("\n");
        lines.forEach((line, idx) => {
          if (line.toLowerCase().includes(query.toLowerCase())) {
            console.log(`  L${idx + 1}: ${line.trim()}`);
          }
        });
      }
    }
  }
}

const queries = ["limit", "large", "file size", "size"];
queries.forEach(q => {
  console.log(`\n--- SEARCHING FOR "${q}" ---`);
  dirs.forEach(d => {
    if (fs.existsSync(d)) {
      searchDir(d, q);
    }
  });
});
