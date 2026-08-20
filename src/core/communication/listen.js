const fs = require("fs");
const path = require("path");
const process = require("process");
const log = require(path.join(__dirname, "..", "util", "log.js"));
const infoService = require(path.join(__dirname, "..", "services", "infoService.js"));
const { createEventApi } = require(path.join(__dirname, "pluginApi.js"));
const { createPluginContext } = require(path.join(__dirname, "pluginContext.js"));

const { shouldMarkAsRead } = require(path.join(__dirname, "markReadPolicy.js"));

function getBaseId(value) {
	var raw = String(value || "");
	var colonIndex = raw.indexOf(":");
	if (colonIndex > 0) return raw.slice(0, colonIndex);
	var atIndex = raw.indexOf("@");
	if (atIndex > 0) return raw.slice(0, atIndex);
	return raw;
}

function normalizeE2EEEvent(event) {
	if (!event) return event;

	if (event.data && event.type && event.type.indexOf("e2ee_") === 0) {
		if (!event.e2ee) event.e2ee = event.data;
		if (!event.threadID && event.data.threadId) {
			event.threadID = String(event.data.threadId);
		}
		if (!event.senderID && event.data.senderId) {
			event.senderID = String(event.data.senderId);
		}
		if (!event.body && event.data.text) {
			event.body = event.data.text;
		}
		if (!event.messageID && event.data.messageId) {
			event.messageID = event.data.messageId;
		}
		if (typeof event.isGroup !== "boolean" && typeof event.data.isGroup === "boolean") {
			event.isGroup = event.data.isGroup;
		}
	}

	if (event.e2ee && !event.threadID && event.e2ee.chatJid) {
		event.threadID = String(event.e2ee.chatJid);
	}

	if (event.e2ee && !event.senderID && event.e2ee.senderJid) {
		event.senderID = getBaseId(event.e2ee.senderJid);
	}

	return event;
}

async function listen(err, event, api) {
	event = normalizeE2EEEvent(event);
	if (!event) return;
	if (!event.threadID && !event.senderID) return;

	if (event.type === "e2ee_message" && event.threadID) {
		global.e2eeThreads = global.e2eeThreads || new Set();
		global.e2eeThreads.add(String(event.threadID));
		const baseId = getBaseId(event.threadID);
		if (baseId) {
			global.e2eeThreads.add(String(baseId));
		}
	}

	// E2EE chat JID is not compatible with markAsRead for legacy threads.
	if (shouldMarkAsRead(global.config, event)) {
		api.markAsRead(event.threadID, (err) => {
			if (err) log.err(err);
		});
	}

	switch (event.type) {
		case "message":
			if (global.threadInfo[event.threadID]) global.threadInfo[event.threadID].messageCount++;
			if (event.attachments.length != 0) {
				let temp = event;
				delete temp.participantIDs;
				log.log("Message", temp);
			}
			else {
				log.log("Message", `[${event.senderID} to ${event.threadID}] ${event.body}`);
			}
			break;
		case "e2ee_message":
			// Handle event structure
			var e2eeData = event.data || event.e2ee || {};
			if (event.senderID && event.senderID.indexOf("@") === -1) {
				event.senderID += "@msgr";
			}
			if (!event.threadID && e2eeData.chatJid) {
				event.threadID = e2eeData.chatJid;
			}
			if (!event.body && e2eeData.text) {
				event.body = e2eeData.text;
			}
			if (e2eeData.replyTo) {
				event.messageReply = {
					senderID: e2eeData.replyTo.senderId ? String(e2eeData.replyTo.senderId) + '@msgr' : undefined,
					messageID: e2eeData.replyTo.messageId,
					body: e2eeData.replyTo.text
				};
			}
			if (global.coreconfig.main_bot.toggleDebug == true) {
				log.log("E2EE", event);
			} else {
				log.log("E2EE", `[${event.senderID || "unknown"} to ${event.threadID || "unknown"}] ${event.body || ""}`);
			}
			break;
		default:
			listenEvent(event);
			if (global.coreconfig.main_bot.toggleDebug == true) {
				log.log(event.type, event);
			}
			else if (event.type == "message_reply" && event.senderID != undefined && event.messageReply) {
				log.log("Message", `[${event.senderID} reply ${event.messageReply.senderID} to ${event.threadID}] ${event.body}`);
			}
			break;
	}

	if (checkList(event.senderID, event.threadID)) mess(event, api);
}

async function mess(event, api) {
	//Running Chathook...
	await chathook(event, api);
	//Convert necessary function
	const getUserInfo = (uid, callback) => infoService.getUserInfo(uid, api, event, callback);
	const getThreadInfo = (tid, callback) => infoService.getThreadInfo(tid, api, callback);
	//Running Command...
	if (event.body != undefined && event.body.slice(0, global.config.facebook.prefix.length) == global.config.facebook.prefix) {
		var cml = event.body.slice(global.config.facebook.prefix.length, event.body.length);
		var ms = cml.split(" ");
		var check = false;
		for (var i in global.plugins) {
			if (global.plugins[i].command[ms[0]] != undefined) {
				event.args = event.body;
				event.args = event.args.split(" ");

				event.body = event.body.split(" ");
				event.body.splice(0, 1);
				event.body = event.body.join(" ");

				try {
					let name = global.plugins[i].command[ms[0]].namePlugin;
					let mainFunc = global.plugins[i].plugins[name].fullFunc;
					let func = global.plugins[i].command[ms[0]].mainFunc;

					let adv = {
						pluginName: name,
						lang: global.lang[name],
						rlang: (inp) => {
							return global.lang[name][inp][global.config.bot_info.lang];
						},
						iso639: global.config.bot_info.lang,
						config: global.configPl[name],
						replaceMap,
						getUserInfo,
						getThreadInfo,
						e2ee: global.e2ee
					};

					const pluginApi = createEventApi(api, event, global.e2eeClient, log);
					const ctx = createPluginContext({ api, event, e2eeClient: global.e2eeClient, log });
					adv.ctx = ctx;
					adv.message = ctx;
					adv.send = ctx.send;
					adv.reply = ctx.reply;
					adv.react = ctx.react;
					adv.unsend = ctx.unsend;
					adv.isE2EE = ctx.isE2EE;
					await mainFunc[func](event, pluginApi, global.e2ee, adv);
				}
				catch (err) {
					log.err(global.plugins[i].command[ms[0]].namePlugin, err);
					api.sendMessage(err && err.message ? err.message : String(err), event.threadID, event.messageID);
				}

				check = true;
				break;
			}
		}
		if (!check) {
			if (ms[0].trim() !== "" && global.plugins.Y2TB && global.plugins.Y2TB.command["help"]) {
				// Route to help plugin for suggestions
				event.args = [global.config.facebook.prefix + "help", ms[0]];
				event.body = ms[0];
				
				try {
					let name = global.plugins.Y2TB.command["help"].namePlugin;
					let mainFunc = global.plugins.Y2TB.plugins[name].fullFunc;
					let func = global.plugins.Y2TB.command["help"].mainFunc;

					let adv = {
						pluginName: name,
						lang: global.lang[name],
						rlang: (inp) => {
							return global.lang[name] && global.lang[name][inp] ? global.lang[name][inp][global.config.bot_info.lang] : inp;
						},
						iso639: global.config.bot_info.lang,
						config: global.configPl[name],
						replaceMap,
						getUserInfo,
						getThreadInfo,
						e2ee: global.e2ee
					};

					const pluginApi = createEventApi(api, event, global.e2eeClient, log);
					const ctx = createPluginContext({ api, event, e2eeClient: global.e2eeClient, log });
					adv.ctx = ctx;
					adv.message = ctx;
					adv.send = ctx.send;
					adv.reply = ctx.reply;
					adv.react = ctx.react;
					adv.unsend = ctx.unsend;
					adv.isE2EE = ctx.isE2EE;
					
					await mainFunc[func](event, pluginApi, global.e2ee, adv);
				} catch (err) {
					log.err("Help fallback", err);
				}
			} else if (ms[0].trim() !== "") {
				let rt = "Please install the “Help” plugin to see the available commands!"
				if (global.lang["Help"] && global.lang["Help"].exitCM) {
					rt = global.lang["Help"].exitCM[global.config.bot_info.lang].replace("{0}", global.config.facebook.prefix);
				}
				api.sendMessage(rt, event.threadID, event.messageID);
			}
		}
	}

}

async function chathook(event, api) {
	const getUserInfo = (uid, callback) => infoService.getUserInfo(uid, api, event, callback);
	const getThreadInfo = (tid, callback) => infoService.getThreadInfo(tid, api, callback);
	try {
		event.args = event.body;
		event.args = event.args.split(" ");
	} catch (_) { }
	for (var i in global.chathook) {
		try {
			let name = global.chathook[i].main;
			if (!global.plugins || !global.plugins.Y2TB || !global.plugins.Y2TB.plugins[name]) {
				log.warn("Chathook", `Skip ${name} because plugin not loaded`);
				continue;
			}
			let mainFunc = global.plugins.Y2TB.plugins[name].fullFunc
			var func = global.chathook[i].func;

			let adv = {
				pluginName: name,
				lang: global.lang[name],
				rlang: (inp) => {
					return global.lang[name] ? global.lang[name][inp][global.config.bot_info.lang] : inp;
				},
				iso639: global.config.bot_info.lang,
				config: global.configPl[name],
				replaceMap: replaceMap,
				getUserInfo,
				getThreadInfo,
				e2ee: global.e2ee
			};

			const pluginApi = createEventApi(api, event, global.e2eeClient, log);
			const ctx = createPluginContext({ api, event, e2eeClient: global.e2eeClient, log });
			adv.ctx = ctx;
			adv.message = ctx;
			adv.send = ctx.send;
			adv.reply = ctx.reply;
			adv.react = ctx.react;
			adv.unsend = ctx.unsend;
			adv.isE2EE = ctx.isE2EE;
			await mainFunc[func](event, pluginApi, global.e2ee, adv);
		}
		catch (err) {
			log.err(i, err);
		}
	}
}

function checkList(uid, tid) {
	if (global.config.facebook.UIDmode == "blackList") {
		if (global.config.facebook.blackList.indexOf(uid) == -1 && global.config.facebook.blackList.indexOf(tid) == -1) return true;
		return false;
	};
	if (global.config.facebook.UIDmode == "whiteList") {
		if (global.config.facebook.whiteList.indexOf(tid) != -1) return true;
		if (global.config.facebook.whiteList.indexOf(uid) != -1) return true;
		return false;
	};
	return true;
}

function listenEvent(event) {
	if (event.type == "message_reply" && global.threadInfo[event.threadID]) return global.threadInfo[event.threadID].messageCount++;
	if (event.type == "change_thread_image" && global.threadInfo[event.threadID]) return global.threadInfo[event.threadID].imageSrc = event.image.url;
	switch (event.logMessageType) {
		case 'log:unsubscribe':
			global.threadInfo[event.threadID] ? global.threadInfo[event.threadID].participantIDs = event.participantIDs : "";
			if (global.threadInfo[event.threadID]) {
				let admins = normalizeAdminIDs(global.threadInfo[event.threadID].adminIDs);
				global.threadInfo[event.threadID].adminIDs = admins.filter((id) => id != event.logMessageData.leftParticipantFbId);
			}
			break;

		case 'log:subscribe':
			//console.log(event.logMessageData.addedParticipants);
			global.threadInfo[event.threadID] ? global.threadInfo[event.threadID].participantIDs = event.participantIDs : "";
			break;
		case 'change_thread_admins':
			if (!global.threadInfo[event.threadID]) break;
			global.threadInfo[event.threadID].adminIDs = normalizeAdminIDs(global.threadInfo[event.threadID].adminIDs);
			if (event.logMessageData.ADMIN_EVENT == "remove_admin") {
				global.threadInfo[event.threadID].adminIDs = global.threadInfo[event.threadID].adminIDs.filter((id) => id != event.logMessageData.TARGET_ID);
			} else {
				if (global.threadInfo[event.threadID].adminIDs.indexOf(event.logMessageData.TARGET_ID) == -1) {
					global.threadInfo[event.threadID].adminIDs.push(event.logMessageData.TARGET_ID)
				}
			}
			break;
		case 'log:thread-name':
			if (!global.threadInfo[event.threadID]) break;
			global.threadInfo[event.threadID].name = global.threadInfo[event.threadID].threadName = event.logMessageData.name;
			break;
		case 'log:user-nickname':
			if (!global.threadInfo[event.threadID]) break;
			if (event.logMessageData.nickname != '') global.threadInfo[event.threadID].nicknames[event.logMessageData.participant_id] = event.logMessageData.nickname;
			else delete global.threadInfo[event.threadID].nicknames[event.logMessageData.participant_id]
			break;
		case 'log:thread-color':
			if (!global.threadInfo[event.threadID]) break;
			global.threadInfo[event.threadID].color = event.logMessageData.theme_color.replace("FF", "");
			if (event.logMessageData.theme_emoji) global.threadInfo[event.threadID].emoji = event.logMessageData.theme_emoji;
			break;
	}
}

function replaceMap(str, map) {
	str = str + "";
	for (let i in map)
		str = str.replaceAll(i, map[i]);
	return str;
}

function normalizeAdminIDs(adminIDs) {
	if (!Array.isArray(adminIDs)) return [];
	return adminIDs
		.map((item) => (item && typeof item === "object") ? item.id : item)
		.filter(Boolean)
		.map((id) => String(id));
}

module.exports = listen;