//Require stuffs

require("dotenv").config({ path: require("path").join(__dirname, "..", "config", "config.env") });
const fs = require("fs");
const path = require("path");
const login = require("fca-unofficial");
const readline = require("readline");
const axios = require("axios");
const AdmZip = require("adm-zip");
const cmd = require('child_process');
var lx = require("luxon");
var log = require("./core/util/log.js"); log.sync();
var scanDir = require("./core/util/scanDir.js");

const ROOT = path.join(__dirname, "..");

const linkUpdate = "https://github.com/VangBanLaNhat/Y2TB-Bot/archive/refs/heads/main.zip";
const versionUpdate = "https://raw.githubusercontent.com/VangBanLaNhat/Y2TB-Bot/main/package.json";
const folderUpdate = "Y2TB-Bot";

//Write logs

var dt = lx.DateTime.now().setZone("Asia/Ho_Chi_Minh");
ensureExists(path.join(ROOT, "logs"));
global.logStart = `${dt.day}D${dt.month}M${dt.year}Y.T${dt.hour}H${dt.minute}M${dt.second}S`;
var ll = scanDir(".txt", path.join(ROOT, "logs"));
for (var i = 0; i < ll.length; i++) {
	var lll = ll[i].slice(0, 2);
	lll = lll.replace("D", "");
	if (dt.day.toString() != lll) {
		fs.unlinkSync(path.join(ROOT, "logs", ll[i]));
	}
}

//Main function

(async () => {

	// Load config first
	console.log("Config", "Loading config...");
	try {
		global.config = require("./core/util/getConfig.js").getConfig();
		global.coreconfig = require("./core/util/getConfig.js").getCoreConfig();
		console.log("Config", "Loading config success!");
		log.blank();
	}
	catch (err) {
		console.log(err);
		console.error("Config", "Can't load Config. Existing...");
		log.blank();
		process.exit(101);
	}

	// Main update
	const { isCoreAutoUpdateEnabled } = require("./core/util/coreUpdatePolicy");
	if (isCoreAutoUpdateEnabled(global.coreconfig)) {
		console.log("Update", "Core auto-update is enabled. Checking update...");
		let vern = (JSON.parse(fs.readFileSync(path.join(ROOT, "package.json")))).version;
		try {
			var verg = (await axios.get(versionUpdate)).data.version;
		} catch (e) {
			console.error("Update", e, "Failed to connect to to the server!");
			process.exit(504);
		}

		if (fs.existsSync(path.join(ROOT, "update"))) {
			console.warn("Update", "WARNING: Proceeding to overwrite project files and update node_modules...");
			deleteFolderRecursive(path.join(ROOT, "update"));
			if(!fs.existsSync(path.join(ROOT, "data", "user.json"))){
				cmd.execSync("yarn install --non-interactive", {
					stdio: "inherit",
					env: process.env,
					shell: true
				})
				console.log("Update", "Complete update. Proceed to restart...");
				process.exit(7378278);
			}
		}

		if (vern != verg) {
			console.warn("Update", "WARNING: A new update has been discovered. Proceeding to download and apply changes...");
			let pathFile = path.join(ROOT, "update");
			try {
				await downloadUpdate(pathFile);
				console.log("Update", 'Download the update completed!');
			} catch (error) {
				console.error("Update", 'Error generation during the download process: ' + error);
				process.exit(504);
			}

			try {
				await extractZip(path.join(pathFile, "update.zip"), pathFile);
				fs.unlinkSync(path.join(pathFile, "update.zip"));
				console.log("Update", 'Extraction completed!');
			} catch (error) {
				fs.unlinkSync(path.join(pathFile, "update.zip"));
				console.error("Update", error);
				process.exit(504);
			}

			let minus = ["tool", "plugins", "config", "data", "logs", "lang"];

			let listFile = fs.readdirSync(path.join(pathFile, folderUpdate));
			// delete require.cache[require.resolve("./core/util/log.js")];
			// delete require.cache[require.resolve("./core/util/scanDir.js")]
			for (let i of listFile)
				if (minus.indexOf(i) == -1) {
					if (!fs.lstatSync(path.join(pathFile, folderUpdate, i)).isFile()) copyFolder(path.join(pathFile, folderUpdate, i), path.join(pathFile, "..", i));
					else fs.renameSync(path.join(pathFile, folderUpdate, i), path.join(pathFile, "..", i));
				}
			console.log("Update", "Complete update. Proceed to restart...");
			process.exit(7378278);

		} else console.log("Update", "Awesome, you're on the latest version!");
	} else {
		console.log("Update", "Core auto-update is disabled (Y2TB_CORE_UPDATE_AUTO is false or unset). Skipping update checks.");
	}

	//data loader

	console.log("Data", "Loading data...");
	try {
		require("./core/util/getData.js").getdt();
		require("./core/util/getData.js").getUser();
		global.threadInfo = {};
		console.log("Data", "Loading data success!");
	}
	catch (err) {
		console.log(err);
		console.error("Data", "Can't load Data. Existing...");
		log.blank();
		process.exit(102);
	}
	setInterval(function () {
		try {
			fs.writeFileSync(path.join(ROOT, "data", "data.json"), JSON.stringify(global.data, null, 4), { mode: 0o666 });
			fs.writeFileSync(path.join(ROOT, "data", "user.json"), JSON.stringify(global.userInfo, null, 4), { mode: 0o666 });
		}
		catch (err) {
			if (err != 'TypeError [ERR_INVALID_ARG_TYPE]: The "data" argument must be of type string or an instance of Buffer, TypedArray, or DataView. Received undefined') console.error("Data", "Can't auto save data with error: " + err);
		}
	}, global.coreconfig.main_bot.dataSaveTime * 1000)

	//plugin auto update

	console.log("Plugins(Update)", "Checking plugin updates...");
	try {
		await require("./core/util/pluginAutoUpdate.js")();
	} catch (err) {
		console.warn("Plugins(Update)", "Auto update failed:", err);
	}

	//loadPlugins

	console.log("Plugin", "Loading Plugins...")
	try {
		ensureExists(path.join(ROOT, "lang"));
		await require("./core/util/loadPlugin.js")();

		process.reload = async () => {
			console.warn("Plugins", "Start reload...")
			await require("./core/util/unloadPlugin.js")(); // Unload Plugins

			await require("./core/util/loadPlugin.js")(); // Reload Plugins

			console.log("Languages", "Loading Languages...");
			require("./core/util/loadLang.js")(); // Reload Languages

			console.log("Config", "Loading config for plugins...");
			require("./core/util/loadConfig.js")(); // Reload Config of Plugins

			console.warn("Plugins", "Plugins have been reloaded!");
		}
	}
	catch (err) {
		console.error("Plugins", "Can't load plugins with error: " + err);
	}

	//loadLang

	console.log("Languages", "Loading Languages...");
	require("./core/util/loadLang.js")();

	//Load Config of plugins

	console.log("Config", "Loading config for plugins...");
	require("./core/util/loadConfig.js")();
	
	//credentials loader

	let fbCredentials = {
		email: global.config.facebook.FBemail,
		password: global.config.facebook.FBpassword
	}
	console.log("Manager", "Loading User-credentials...");
	const fbStatePath = path.join(ROOT, "config", "fbstate.json");
	const fbStateAlt = path.join(ROOT, "config", "fbsstate.json");
	const fbStateExisting = fs.existsSync(fbStatePath) ? fbStatePath : (fs.existsSync(fbStateAlt) ? fbStateAlt : null);
	if (fbStateExisting) {
		console.log("Facebook", `=> Login account using FBstate`)
	} else if (fbCredentials.email == "" && fbCredentials.password == "") {
		console.error("Facebook", "=> No FBstate and FBCredentials blank "); 
		console.error("Facebook", "=> Unable to login!");
		process.exit();
	} else {
		console.log("Facebook", `=> Login account using FBCredentials`)
	}
	
	console.blank();

// 	//login facebook!!!

	var loginstate;
	(!fbStateExisting && fbCredentials.email == "" && fbCredentials.password == "") ? loginstate = false : loginstate = true
	if (loginstate) {
		let e2eeEnabled = !!global.coreconfig.facebook.enableE2EE;
		let e2eeDeviceStorePath = global.coreconfig.facebook.e2eeDeviceStorePath
			|| global.coreconfig.facebook.e2eeDevicePath
			|| "config/device-store.json";
		if (typeof e2eeDeviceStorePath === "string" && !path.isAbsolute(e2eeDeviceStorePath)) {
			e2eeDeviceStorePath = path.join(ROOT, e2eeDeviceStorePath);
		}
		let e2eeSessionStorePath = global.coreconfig.facebook.e2eeSessionStorePath || "";
		if (typeof e2eeSessionStorePath === "string" && e2eeSessionStorePath !== "" && !path.isAbsolute(e2eeSessionStorePath)) {
			e2eeSessionStorePath = path.join(ROOT, e2eeSessionStorePath);
		}
		let appStatePath = fbStateExisting || path.join(ROOT, "config", "fbstate.json");
		let loginOptions = {
			"logLevel": global.coreconfig.facebook.logLevel,
			"userAgent": global.coreconfig.facebook.userAgent,
			"selfListen": global.config.facebook.selfListen,
			"listenEvents": global.coreconfig.facebook.listenEvents,
			"updatePresence": global.coreconfig.facebook.updatePresence,
			"autoMarkRead": global.config.facebook.autoMarkRead
		};
		let botOptions = {
			"enableE2EE": e2eeEnabled,
			"e2eeAutoConnect": global.coreconfig.facebook.e2eeAutoConnect !== false,
			"e2eeDeviceStorePath": e2eeDeviceStorePath,
			"e2eeSessionStorePath": e2eeSessionStorePath,
			"fbStatePath": appStatePath
		}
		console.log("Manager", "Logging...")
		let appState = {};
		if (fs.existsSync(appStatePath)) {
			//login using appstate
			appState = JSON.parse(fs.readFileSync(appStatePath, "utf-8"));
			await require("./core/communication/fb.js")(appState, loginOptions, botOptions);
		} else {
			//login using credentials then create appstate
			console.log("Manager", "Creating appstate for further login...");
			var rl = readline.createInterface({
				input: process.stdin,
				output: process.stdout
			});
			login(fbCredentials, loginOptions, (err, api) => {
				console.log(err);
				if (err) {
					switch (err.error) {
						case 'login-approval':
							console.log("Login", "Account detected with 2-step verification (2-FA) enabled\nPlease enter verification code to continue");
							rl.question("Verification code: ", (code) => {
								err.continue(code);
								rl.close();
							});
							break;
						default:
							console.error("login", err);
					}
					return;
				}

				appState = api.getAppState();
				require("./core/communication/fb.js")(appState, loginOptions, botOptions);
				fs.writeFileSync(appStatePath, JSON.stringify(appState, null, "\t"));
				if (fbStateExisting && fbStateExisting !== appStatePath && fs.existsSync(fbStateExisting)) {
					// fs.unlinkSync(fbStateExisting);
				}
			});
		}
	}
})();

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('exit', function (code) {
	try {
		fs.writeFileSync(path.join(ROOT, "data", "data.json"), JSON.stringify(global.data, null, 4), { mode: 0o666 });
		fs.writeFileSync(path.join(ROOT, "data", "user.json"), JSON.stringify(global.userInfo, null, 4), { mode: 0o666 });
		console.log("Data", "Saved data!")
			//fs.writeFileSync(path.join(ROOT, "data", "prdata.json"), JSON.stringify(global.prdata, null, 4), {mode: 0o666});
	}
	catch (err) {
		if (err != 'TypeError [ERR_INVALID_ARG_TYPE]: The "data" argument must be of type string or an instance of Buffer, TypedArray, or DataView. Received undefined') console.error("Data", "Can't auto save data with error: " + err);
	}
});

async function downloadUpdate(pathFile) {
	let url = linkUpdate;

	ensureExists(pathFile);

	try {
		const response = await axios({
			url,
			method: 'GET',
			responseType: 'stream'
		});

		const writer = fs.createWriteStream(path.join(pathFile, "update.zip"));

		response.data.pipe(writer);

		return new Promise((resolve, reject) => {
			writer.on('finish', resolve);
			writer.on('error', reject);
		});
	} catch (error) {
		console.error("Update", 'Error downloading file: ' + error);
		process.exit(504);
	}
}

function extractZip(filePath, destinationPath) {
	return new Promise((resolve, reject) => {
		const zip = new AdmZip(filePath);
		zip.extractAllToAsync(destinationPath, true, (error) => {
			if (error) {
				console.error('Error extracting zip file:', error);
				reject(error);
				process.exit(504);
			} else {
				resolve();
			}
		});
	});
}

function copyFolder(sourcePath, destinationPath) {
	try {
		ensureExists(destinationPath);

		const files = fs.readdirSync(sourcePath);

		files.forEach((file) => {
			const sourceFile = path.join(sourcePath, file);
			const destinationFile = path.join(destinationPath, file);

			if (fs.lstatSync(sourceFile).isFile()) {
				fs.copyFileSync(sourceFile, destinationFile);
			} else {
				copyFolder(sourceFile, destinationFile);
			}
		});

	} catch (error) {
		console.error("Update", 'Error copying folder: ' + error);
	}
}

function deleteFolderRecursive(folderPath) {
	if (fs.existsSync(folderPath)) {
		fs.readdirSync(folderPath).forEach((file) => {
			const curPath = folderPath + '/' + file;

			if (fs.lstatSync(curPath).isDirectory()) {
				deleteFolderRecursive(curPath);
			} else {
				fs.unlinkSync(curPath);
			}
		});

		fs.rmdirSync(folderPath);
	} else {
		console.log('Folder does not exist.');
	}
}

function ensureExists(path, mask) {
	if (typeof mask != 'number') {
		mask = 0o777;
	}
	try {
		fs.mkdirSync(path, {
			mode: mask,
			recursive: true
		});
		return;
	} catch (ex) {
		return {
			err: ex
		};
	}
}
