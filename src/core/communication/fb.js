const login = require("fca-unofficial")
const fs = require("fs");
const path = require("path");
const { FBClient } = require("fb-messenger-e2ee");
const listen = require(path.join(__dirname, "listen.js"))
var log = require(path.join(__dirname, "..", "util", "log.js"));

const ROOT = path.join(__dirname, "..", "..", "..");

function resolveFbStatePath(opts) {
    if (opts && typeof opts.fbStatePath === "string" && opts.fbStatePath.trim() !== "") {
        return opts.fbStatePath;
    }
    return path.join(ROOT, "config", "fbstate.json");
}

function writeFbState(api, fbStatePath) {
    if (!api || typeof api.getAppState !== "function") {
        throw new Error("getAppState is not available on current API instance");
    }

    var appState = api.getAppState();
    if (!Array.isArray(appState) || appState.length === 0) {
        throw new Error("Received empty appState");
    }

    fs.mkdirSync(path.dirname(fbStatePath), { recursive: true });
    fs.writeFileSync(fbStatePath, JSON.stringify(appState, null, "\t"), { mode: 0o666 });
}

function saveFbStateAtLogin(api, opts) {
    var fbStatePath = resolveFbStatePath(opts);

    try {
        writeFbState(api, fbStatePath);
        log.log("Facebook", "Saved fbstate at login: " + fbStatePath);
    } catch (saveErr) {
        log.warn("Facebook", "Saving fbstate at login failed: " + (saveErr && saveErr.message ? saveErr.message : saveErr));
    }
}

function isE2EEThread(threadID) {
    if (!threadID) return false;
    const s = String(threadID);
    if (s.includes("@msgr") || s.includes("@g.us") || s.includes(".g.")) return true;
    if (/^\d+$/.test(s)) {
        return !!(global.e2eeThreads && global.e2eeThreads.has(s));
    }
    return false;
}

function createE2EEContext(api, e2eeClient) {
    return {
        enabled: !!e2eeClient,
        client: e2eeClient || null,
        isE2EEThread,
        sendText: function (threadID, text, replyMessageID) {
            if (e2eeClient && isE2EEThread(threadID)) {
                const input = { threadId: String(threadID), text: String(text || "") };
                if (replyMessageID) input.replyToMessageId = String(replyMessageID);
                return e2eeClient.sendMessage(input);
            }
            return new Promise((resolve, reject) => {
                api.sendMessage(String(text || ""), threadID, (err, res) => {
                    if (err) return reject(err);
                    resolve(res);
                }, replyMessageID);
            });
        },
        sendMessage: function (msg, threadID, callback, replyMessageID) {
            return api.sendMessage(msg, threadID, callback, replyMessageID);
        }
    };
}

function wrapApiForE2EE(api, e2eeClient) {
    const originalSendMessage = api.sendMessage;
    api.sendMessage = function (msg, threadID, callback, replyMessageID) {
        const hasAttachment = msg && typeof msg === "object" && msg.attachment;
        if (e2eeClient && isE2EEThread(threadID) && !hasAttachment) {
            const input = { threadId: String(threadID) };
            if (typeof msg === "string") {
                input.text = msg;
            } else if (msg && typeof msg === "object") {
                if (msg.body) input.text = msg.body;
                // Basic attachment support could be added here if needed
            }

            if (replyMessageID) input.replyToMessageId = String(replyMessageID);

            if (input.text) {
                e2eeClient.sendMessage(input)
                    .then(res => {
                        if (res && res.messageId && !res.messageID) {
                            res.messageID = res.messageId;
                        }
                        if (typeof callback === "function") callback(null, res);
                    })
                    .catch(err => {
                        log.warn("E2EE", `Send failed, falling back to plaintext: ${err.message}`);
                        originalSendMessage.call(api, msg, threadID, callback, replyMessageID);
                    });
                return;
            }
        }
        return originalSendMessage.call(api, msg, threadID, callback, replyMessageID);
    };

    if (api.setMessageReaction) {
        const originalReaction = api.setMessageReaction;
        api.setMessageReaction = function (reaction, messageID, callback, force) {
            // Note: E2EE reaction requires threadId which is not always in setMessageReaction args.
            // In VBLN, usually plugins call it. We might need a way to track messageID -> threadID.
            // For now, we only use E2EE reaction if we can infer the thread.
            // However, fca's setMessageReaction doesn't take threadID.
            // If the messageID is clearly an E2EE one (often very long numeric strings), we might try.
            return originalReaction.call(api, reaction, messageID, callback, force);
        };
    }

    if (api.unsendMessage) {
        const originalUnsend = api.unsendMessage;
        api.unsendMessage = function (messageID, callback) {
            // E2EE unsend also needs threadId in the new lib.
            // But fca doesn't provide it. We'll use plaintext fallback for now unless we enhance this.
            return originalUnsend.call(api, messageID, callback);
        };
    }
}

module.exports = async (appState, loginOptions, botOptions) => {
    var opts = Object.assign({}, loginOptions || {});
    var botOpts = Object.assign({}, botOptions || {});
    delete opts["userAgent"];
	
    login({ appState }, opts, async (err, api) => {
        if (err) {
            const fbStatePath = path.join(ROOT, "config", "fbstate.json");
            const fbStateAlt = path.join(ROOT, "config", "fbsstate.json");
            // if (fs.existsSync(fbStatePath)) fs.unlinkSync(fbStatePath);
            // else if (fs.existsSync(fbStateAlt)) fs.unlinkSync(fbStateAlt);
            log.err("Login", err);
            process.exit(1);
        }
        if(!global.botid){
            global.botid = api.getCurrentUserID()+"";
        }

        log.log("Manager","Login successfuly!");
        saveFbStateAtLogin(api, botOpts);

        global.e2ee = createE2EEContext(api, null);

        for(let i in global.plugins.Y2TB.plugins){
            try{
            	let adv = {
            		pluginName: i,
            		lang: global.lang[i],
            		rlang: (inp)=>{
                    		return global.lang[i][inp][global.config.bot_info.lang];
                    	},
            		iso639: global.config.bot_info.lang,
            		config: global.configPl[i],
            		replaceMap: replaceMap,
            		getUserInfo: api.getUserInfo,
                    getThreadInfo: api.getThreadInfo,
                    e2ee: global.e2ee
            	};
                await global.plugins.Y2TB.plugins[i].loginFunc(api, global.e2ee, adv);
                delete global.plugins.Y2TB.plugins[i].loginFunc;
            } catch(e){}
        }
        try{
		  api.listenMqtt((err, event) => {
		  	listen(err, event, api);
		  });
        } catch (e) {};

        if (botOpts.enableE2EE !== false) {
            const e2eeOptions = resolveE2EEOptions(botOpts);
            if (!e2eeOptions) {
                log.warn("E2EE", "deviceStorePath is missing. Set e2eeDeviceStorePath in bot config.");
            } else {
                try {
                    const e2eeClient = new FBClient({
                        appState: appState,
                        sessionStorePath: e2eeOptions.sessionStorePath
                    });

                    log.log("E2EE", "Connecting to E2EE stream...");
                    const { userId } = await e2eeClient.connect();
                    await e2eeClient.connectE2EE(e2eeOptions.deviceStorePath, userId);

                    wrapApiForE2EE(api, e2eeClient);
                    global.e2ee = createE2EEContext(api, e2eeClient);
                    global.e2eeClient = e2eeClient;

                    e2eeClient.onEvent((event) => {
                        if (event.type === "e2ee_connected") {
                            log.log("E2EE", "E2EE stream is ready.");
                        } else if (event.type === "error") {
                            log.warn("E2EE", `Stream error: ${event.data.message}`);
                        } else {
                            try {
                                listen(null, event, api);
                            } catch (listenErr) {
                                log.warn("E2EE", `Listen error: ${listenErr.message}`);
                            }
                        }
                    });

                    log.log("E2EE", `Connected (device: ${e2eeOptions.deviceStorePath})`);
                } catch (connectErr) {
                    log.warn("E2EE", `Initialization failed: ${connectErr.message}`);
                }
            }
        }
    })
}

function replaceMap(str, map){
    str = str+"";
	for(let i in map)
		str = str.replaceAll(i, map[i]);
	return str;
}

function resolveE2EEOptions(opts) {
    var deviceStorePath = opts.e2eeDeviceStorePath || opts.e2eeDevicePath || "";
    if (!deviceStorePath) return null;
    var resolvedDevicePath = path.resolve(deviceStorePath);

    var sessionStorePath = opts.e2eeSessionStorePath || "";
    var resolvedSessionPath = sessionStorePath ? path.resolve(sessionStorePath) : "";

    try {
        fs.mkdirSync(path.dirname(resolvedDevicePath), { recursive: true });
        if (resolvedSessionPath) {
            fs.mkdirSync(path.dirname(resolvedSessionPath), { recursive: true });
        }
    } catch (_) {}

    var out = { deviceStorePath: resolvedDevicePath };
    if (resolvedSessionPath) out.sessionStorePath = resolvedSessionPath;
    return out;
}
