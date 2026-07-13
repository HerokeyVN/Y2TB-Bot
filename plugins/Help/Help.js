const fs = require('fs');
const path = require('path');

let cache = {
    pluginCount: 0,
    metadata: null
};

const CATEGORY_RULES = [
    {
        key: "game",
        vi: "Trò chơi",
        en: "Games",
        match: ["hunt", "bầu cua", "coin flip", "xpchat"]
    },
    {
        key: "economy",
        vi: "Kinh tế",
        en: "Economy",
        match: ["economy", "coin", "bal", "daily", "work"]
    },
    {
        key: "ai",
        vi: "AI",
        en: "AI",
        match: ["chatgpt", "gemini", "csim"]
    },
    {
        key: "media",
        vi: "Media",
        en: "Media",
        match: ["youtube", "spotify", "tiktok", "pinterest", "qrcode"]
    },
    {
        key: "group",
        vi: "Nhóm chat",
        en: "Group",
        match: ["group", "notifytag", "joinnoti", "adduser", "antiunsend"]
    },
    {
        key: "utility",
        vi: "Tiện ích",
        en: "Utilities",
        match: ["math", "weather", "searchwiki", "chemical", "ping"]
    },
    {
        key: "admin",
        vi: "Quản trị",
        en: "Admin",
        match: ["eval", "restart", "unsend", "facebook"]
    },
    {
        key: "other",
        vi: "Khác",
        en: "Other",
        match: []
    }
];

const CATEGORY_EMOJIS = {
    "game": "🎮",
    "economy": "💰",
    "ai": "🤖",
    "media": "🎬",
    "group": "💬",
    "utility": "🛠️",
    "admin": "⚙️",
    "other": "📦"
};

function main(data, api, e2ee, adv) {
    if (!global.plugins || !global.plugins.Y2TB) {
        return safeReply(data, api, adv, "Error: Bot plugins registry is not loaded.");
    }

    const args = getArgs(data);

    // 1. no args -> dashboard page 1
    if (args.length === 0) {
        return showDashboard(data, api, adv, 1);
    }

    // 2. first arg numeric -> dashboard page N
    if (isPositiveIntegerText(args[0])) {
        const page = parseInt(args[0], 10);
        return showDashboard(data, api, adv, page);
    }

    const firstArgLower = args[0].toLowerCase();

    // 3. first arg "plugins" -> plugin list page
    if (firstArgLower === "plugins") {
        const page = getPage(args.slice(1), 1);
        return showPluginsList(data, api, adv, page);
    }

    // 4. first arg "all" -> all commands page
    if (firstArgLower === "all") {
        const page = getPage(args.slice(1), 1);
        return showAllCommands(data, api, adv, page);
    }

    // 5. first arg "search" -> search mode
    if (firstArgLower === "search") {
        if (args.length < 2) {
            return safeReply(data, api, adv, t(adv, "helpSearchUsage", null, `Dùng: ${getPrefix()}help search <từ khóa> [trang]`));
        }
        const searchArgs = args.slice(1);
        const parsed = parseArgs(searchArgs);
        return showSearch(data, api, adv, parsed.query, parsed.page);
    }

    // Routing Priority:
    // 6. exact plugin match
    // 7. exact command match
    // 8. fuzzy plugin match
    // 9. fuzzy command match
    // 10. suggestions / no result
    const metadata = collectHelpMetadata();
    const parsed = parseArgs(args);
    const queryLower = parsed.query.toLowerCase();
    const queryNormalized = queryLower.replace(/\s+/g, "");

    // Exact plugin match
    const exactPlugin = metadata.plugins.find(p => p.normalizedName === queryNormalized);
    if (exactPlugin) {
        return showPluginHelp(data, api, adv, exactPlugin, parsed.page);
    }

    // Exact command match
    const exactCmdList = metadata.commandIndex.get(queryLower);
    if (exactCmdList && exactCmdList.length > 0) {
        return showCommandDetail(data, api, adv, exactCmdList);
    }

    // Fuzzy plugin match
    const fuzzyPlugin = metadata.plugins.find(p => p.pluginName.toLowerCase().startsWith(queryLower)) ||
                        metadata.plugins.find(p => p.pluginName.toLowerCase().includes(queryLower));
    if (fuzzyPlugin) {
        return showPluginHelp(data, api, adv, fuzzyPlugin, parsed.page);
    }

    // Fuzzy command match
    const fuzzyCmdName = Array.from(metadata.commandIndex.keys()).find(c => c.startsWith(queryLower)) ||
                         Array.from(metadata.commandIndex.keys()).find(c => c.includes(queryLower));
    if (fuzzyCmdName) {
        const fuzzyCmdList = metadata.commandIndex.get(fuzzyCmdName);
        return showCommandDetail(data, api, adv, fuzzyCmdList);
    }

    // No result & suggestions
    const suggestions = getSuggestions(metadata, parsed.query);
    if (suggestions.length > 0) {
        const listStr = suggestions.map((s, idx) => `${idx + 1}. ${s.name}`).join("\n");
        const suggestionsText = t(adv, "helpSuggestions", {
            "{suggestions}": listStr,
            "{prefix}": getPrefix(),
            "{input}": parsed.query
        }, `Có thể bạn muốn:\n${listStr}\n\nDùng ${getPrefix()}help search ${parsed.query} để tìm thêm.`);
        
        const noResultText = t(adv, "helpNoResult", { "{input}": parsed.query }, `Không tìm thấy \`{input}\`.`);
        return safeReply(data, api, adv, `${noResultText}\n\n${suggestionsText}`);
    } else {
        const noResultText = t(adv, "helpNoResult", { "{input}": parsed.query }, `Không tìm thấy \`{input}\`.`);
        return safeReply(data, api, adv, noResultText);
    }
}

// Help Formatters
function showDashboard(data, api, adv, page = 1) {
    const lang = getLang(adv);
    const prefix = getPrefix();
    const metadata = collectHelpMetadata();

    let totalCommands = 0;
    const visiblePlugins = [];

    for (const plugin of metadata.plugins) {
        const visibleCmds = plugin.commands.filter(c => shouldShowCommand(c, data.senderID, data.threadID));
        if (visibleCmds.length > 0) {
            visiblePlugins.push({
                ...plugin,
                commands: visibleCmds
            });
            totalCommands += visibleCmds.length;
        }
    }

    // Sort plugins by category priority and name
    visiblePlugins.sort((a, b) => {
        const catA = getInferredCategory(a, lang);
        const catB = getInferredCategory(b, lang);
        const priA = getCategoryPriority(catA, lang);
        const priB = getCategoryPriority(catB, lang);

        if (priA !== priB) {
            return priA - priB;
        }
        return a.pluginName.localeCompare(b.pluginName);
    });

    const perPage = 8;
    const totalPages = Math.ceil(visiblePlugins.length / perPage);
    if (!validatePage(page, totalPages, data, api, adv)) {
        return;
    }

    const start = (page - 1) * perPage;
    const pagePlugins = visiblePlugins.slice(start, start + perPage);

    const pluginListStr = formatPagedDashboardList(pagePlugins, start, lang);
    const dashboardText = t(adv, "helpDashboard", {
        "{commandCount}": String(totalCommands),
        "{pluginCount}": String(visiblePlugins.length),
        "{pluginList}": pluginListStr,
        "{prefix}": prefix,
        "{page}": String(page),
        "{totalPages}": String(totalPages)
    }, `📚 Y2TB Bot Help\n\nHiện có ${totalCommands} lệnh trong ${visiblePlugins.length} plugin.\n\nNhóm lệnh - Trang ${page}/${totalPages}:\n${pluginListStr}\n\nCách dùng:\n${prefix}help <plugin> - Xem lệnh trong plugin\n${prefix}help <lệnh> - Xem chi tiết một lệnh\n${prefix}help search <từ khóa> - Tìm lệnh\n${prefix}help all <trang> - Xem tất cả lệnh\n${prefix}help <trang> - Xem trang nhóm lệnh khác\n\nVí dụ:\n${prefix}help Hunt\n${prefix}help petbattle\n${prefix}help search tiền\n${prefix}help 2`);

    return safeReply(data, api, adv, dashboardText);
}

function showPluginsList(data, api, adv, page) {
    const lang = getLang(adv);
    const prefix = getPrefix();
    const metadata = collectHelpMetadata();

    const visiblePlugins = [];
    for (const plugin of metadata.plugins) {
        const visibleCmds = plugin.commands.filter(c => shouldShowCommand(c, data.senderID, data.threadID));
        if (visibleCmds.length > 0) {
            visiblePlugins.push({
                ...plugin,
                commands: visibleCmds
            });
        }
    }

    visiblePlugins.sort((a, b) => {
        const catA = getInferredCategory(a, lang);
        const catB = getInferredCategory(b, lang);
        const priA = getCategoryPriority(catA, lang);
        const priB = getCategoryPriority(catB, lang);

        if (priA !== priB) {
            return priA - priB;
        }
        return a.pluginName.localeCompare(b.pluginName);
    });

    const perPage = 8;
    const totalPages = Math.ceil(visiblePlugins.length / perPage);
    if (!validatePage(page, totalPages, data, api, adv)) {
        return;
    }

    const start = (page - 1) * perPage;
    const pagePlugins = visiblePlugins.slice(start, start + perPage);

    const pluginLines = pagePlugins.map((p, idx) => {
        const globalIdx = start + idx + 1;
        const desc = getLocalizedValue(p.desc, lang, "");
        const descLine = desc ? `\n   ${desc}` : "";
        const cmdCount = p.commands.length;
        const cmdText = lang === "vi_VN" ? `${cmdCount} lệnh` : `${cmdCount} commands`;
        return `${globalIdx}. ${p.pluginName} - ${cmdText}${descLine}`;
    }).join("\n\n");

    const header = t(adv, "pluginsModeHeader", {
        "{page}": String(page),
        "{totalPages}": String(totalPages)
    }, `📦 Danh sách plugin - Trang ${page}/${totalPages}\n`);

    const footer = t(adv, "pluginsModeFooter", { "{prefix}": prefix }, `Dùng ${prefix}help <plugin> để xem lệnh trong plugin.`);

    return safeReply(data, api, adv, `${header}\n${pluginLines}\n\n${footer}`);
}

function showPluginHelp(data, api, adv, plugin, page) {
    const lang = getLang(adv);
    const prefix = getPrefix();

    const visibleCmds = plugin.commands.filter(c => shouldShowCommand(c, data.senderID, data.threadID));
    if (visibleCmds.length === 0) {
        return safeReply(data, api, adv, t(adv, "helpNoResult", { "{input}": plugin.pluginName }, `Không tìm thấy \`{input}\`.`));
    }

    const perPage = 15;
    const totalPages = Math.ceil(visibleCmds.length / perPage);
    if (!validatePage(page, totalPages, data, api, adv)) {
        return;
    }

    const start = (page - 1) * perPage;
    const pageCmds = visibleCmds.slice(start, start + perPage);

    const cmdLines = pageCmds.map((c, idx) => {
        const cmdIndex = start + idx + 1;
        const aliasesStr = (Array.isArray(c.aliases) && c.aliases.length > 0) ? ` / ${c.aliases.join(" / ")}` : "";
        const tag = getLocalizedValue(c.tag, lang, "");
        return `${cmdIndex}. ${c.name}${aliasesStr} - ${tag}`;
    }).join("\n");

    const desc = getLocalizedValue(plugin.desc, lang, "");

    const header = t(adv, "helpPluginHeader", {
        "{pluginName}": plugin.pluginName,
        "{page}": String(page),
        "{totalPages}": String(totalPages),
        "{desc}": desc
    }, `🐾 ${plugin.pluginName} - Trang {page}/{totalPages}\n{desc}\n\nLệnh:`);

    const footer = t(adv, "helpPluginFooter", { "{prefix}": prefix }, `Dùng ${prefix}help <lệnh> để xem chi tiết.`);

    return safeReply(data, api, adv, `${header}\n${cmdLines}\n\n${footer}`);
}

function showCommandDetail(data, api, adv, cmdMatchList) {
    if (cmdMatchList.length > 1) {
        let text = `Có nhiều lệnh trùng tên:\n`;
        cmdMatchList.forEach((c, idx) => {
            text += `${idx + 1}. ${c.name} (Plugin: ${c.pluginName})\n`;
        });
        text += `\nVui lòng dùng: ${getPrefix()}help <pluginName> để xem chi tiết.`;
        return safeReply(data, api, adv, text);
    }

    const c = cmdMatchList[0];
    const lang = getLang(adv);
    const prefix = getPrefix();
    const desc = getLocalizedValue(c.tag, lang, "");
    const help = getLocalizedValue(c.help, lang, "");
    const example = getLocalizedValue(c.example, lang, "");

    const detailText = t(adv, "helpCommandDetail", {
        "{name}": c.name,
        "{pluginName}": c.pluginName,
        "{desc}": desc,
        "{help}": help,
        "{example}": example,
        "{prefix}": prefix
    }, `📖 Lệnh: ${c.name}\n\nPlugin: ${c.pluginName}\nMô tả: ${desc}\nCách dùng: ${prefix}${help}\nVí dụ: ${prefix}${example}`);

    return safeReply(data, api, adv, detailText);
}

function showSearch(data, api, adv, keyword, page) {
    const lang = getLang(adv);
    const prefix = getPrefix();
    const metadata = collectHelpMetadata();

    const queryNormalized = normalizeText(keyword);

    const matches = [];

    for (const plugin of metadata.plugins) {
        const pluginNameNorm = normalizeText(plugin.pluginName);
        const pluginDescNorm = normalizeText(getLocalizedValue(plugin.desc, lang, ""));

        const visibleCmds = plugin.commands.filter(c => shouldShowCommand(c, data.senderID, data.threadID));

        for (const c of visibleCmds) {
            const cmdNameNorm = normalizeText(c.name);
            const cmdTagNorm = normalizeText(getLocalizedValue(c.tag, lang, ""));
            const cmdHelpNorm = normalizeText(getLocalizedValue(c.help, lang, ""));
            const cmdExampleNorm = normalizeText(getLocalizedValue(c.example, lang, ""));

            let match = false;
            if (cmdNameNorm.includes(queryNormalized) ||
                pluginNameNorm.includes(queryNormalized) ||
                cmdTagNorm.includes(queryNormalized) ||
                cmdHelpNorm.includes(queryNormalized) ||
                cmdExampleNorm.includes(queryNormalized) ||
                pluginDescNorm.includes(queryNormalized)) {
                match = true;
            }

            if (!match && Array.isArray(c.aliases)) {
                for (const alias of c.aliases) {
                    if (normalizeText(alias).includes(queryNormalized)) {
                        match = true;
                        break;
                    }
                }
            }

            if (match) {
                matches.push(c);
            }
        }
    }

    if (matches.length === 0) {
        return safeReply(data, api, adv, t(adv, "helpNoResult", { "{input}": keyword }, `Không tìm thấy \`{input}\`.`));
    }

    const perPage = 10;
    const totalPages = Math.ceil(matches.length / perPage);
    if (!validatePage(page, totalPages, data, api, adv)) {
        return;
    }

    const start = (page - 1) * perPage;
    const pageMatches = matches.slice(start, start + perPage);

    const matchLines = pageMatches.map((c, idx) => {
        const cmdIndex = start + idx + 1;
        const tag = getLocalizedValue(c.tag, lang, "");
        return `${cmdIndex}. ${c.name} - ${tag} (${c.pluginName})`;
    }).join("\n");

    const header = t(adv, "helpSearchHeader", {
        "{keyword}": keyword,
        "{count}": String(matches.length)
    }, `🔎 Kết quả tìm kiếm: ${keyword}\nTìm thấy ${matches.length} lệnh.\n`);

    const footer = t(adv, "helpSearchFooter", { "{prefix}": prefix }, `Dùng ${prefix}help <lệnh> để xem chi tiết.`);

    return safeReply(data, api, adv, `${header}\n${matchLines}\n\n${footer}`);
}

function showAllCommands(data, api, adv, page) {
    const lang = getLang(adv);
    const prefix = getPrefix();
    const metadata = collectHelpMetadata();

    const allCommands = [];
    for (const plugin of metadata.plugins) {
        const visibleCmds = plugin.commands.filter(c => shouldShowCommand(c, data.senderID, data.threadID));
        for (const c of visibleCmds) {
            allCommands.push(c);
        }
    }

    // Sort by plugin name, then command name
    allCommands.sort((a, b) => {
        const cmp = a.pluginName.localeCompare(b.pluginName);
        if (cmp !== 0) return cmp;
        return a.name.localeCompare(b.name);
    });

    if (allCommands.length === 0) {
        return safeReply(data, api, adv, t(adv, "helpNoResult", { "{input}": "all" }, `Không tìm thấy \`{input}\`.`));
    }

    const perPage = 20;
    const totalPages = Math.ceil(allCommands.length / perPage);
    if (!validatePage(page, totalPages, data, api, adv)) {
        return;
    }

    const start = (page - 1) * perPage;
    const pageCmds = allCommands.slice(start, start + perPage);

    const cmdLines = pageCmds.map((c, idx) => {
        const cmdIndex = start + idx + 1;
        const aliasesStr = (Array.isArray(c.aliases) && c.aliases.length > 0) ? ` / ${c.aliases.join(" / ")}` : "";
        return `${cmdIndex}. ${c.name}${aliasesStr} (${c.pluginName})`;
    }).join("\n");

    const header = t(adv, "helpAllHeader", {
        "{page}": String(page),
        "{totalPages}": String(totalPages)
    }, `📚 Tất cả lệnh - Trang ${page}/${totalPages}\n`);

    const footer = t(adv, "helpAllFooter", { "{prefix}": prefix }, `Dùng ${prefix}help all <trang> để xem trang khác.`);

    return safeReply(data, api, adv, `${header}\n${cmdLines}\n\n${footer}`);
}

// Helpers
function getLang(adv) {
    return (adv && adv.iso639) || (global.config && global.config.bot_info && global.config.bot_info.lang) || "vi_VN";
}

function getPrefix() {
    return (global.config && global.config.facebook && global.config.facebook.prefix) || "/";
}

function normalizeText(text) {
    if (typeof text !== "string") return "";
    return stripVietnameseAccents(text).toLowerCase().trim();
}

function stripVietnameseAccents(str) {
    if (typeof str !== "string") return "";
    return str
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/đ/g, "d")
        .replace(/Đ/g, "D");
}

function getLocalizedValue(value, lang, fallback = "") {
    if (!value) return fallback;
    if (typeof value === "string") return value;
    if (typeof value === "object") {
        if (value[lang]) return value[lang];
        if (value["vi_VN"]) return value["vi_VN"];
        if (value["en_US"]) return value["en_US"];
        const keys = Object.keys(value);
        if (keys.length > 0) return value[keys[0]];
    }
    return fallback;
}

function getPage(args, defaultPage = 1) {
    if (args.length > 0) {
        const last = args[args.length - 1];
        const page = parseInt(last, 10);
        if (!isNaN(page) && page > 0) {
            return page;
        }
    }
    return defaultPage;
}

function parseArgs(args) {
    let page = 1;
    let query = "";
    if (args.length > 0) {
        const last = args[args.length - 1];
        const p = parseInt(last, 10);
        if (!isNaN(p) && p > 0) {
            page = p;
            query = args.slice(0, -1).join(" ").trim();
        } else {
            query = args.join(" ").trim();
        }
    }
    return { query, page };
}

function formatPagedDashboardList(pagePlugins, startIdx, lang) {
    const grouped = new Map();
    pagePlugins.forEach((plugin, offset) => {
        const catName = getInferredCategory(plugin, lang);
        if (!grouped.has(catName)) {
            grouped.set(catName, []);
        }
        grouped.get(catName).push({
            idx: startIdx + offset + 1,
            plugin
        });
    });

    const lines = [];
    const sortedCats = Array.from(grouped.keys()).sort((a, b) => {
        return getCategoryPriority(a, lang) - getCategoryPriority(b, lang);
    });

    for (const catName of sortedCats) {
        const emoji = getCategoryEmoji(catName, lang);
        lines.push(`\n${emoji} ${catName}`);
        
        const items = grouped.get(catName);
        for (const item of items) {
            const p = item.plugin;
            const desc = getLocalizedValue(p.desc, lang, "");
            const descLine = desc ? `\n   ${desc}` : "";
            const cmdCount = p.commands.length;
            const cmdText = lang === "vi_VN" ? `${cmdCount} lệnh` : `${cmdCount} commands`;
            lines.push(`${item.idx}. ${p.pluginName} - ${cmdText}${descLine}`);
        }
    }
    return lines.join("\n").trim();
}

function getSuggestions(metadata, query) {
    if (/^\d+$/.test(query.trim())) {
        return [];
    }

    const suggestions = [];
    const queryLower = query.toLowerCase();

    for (const plugin of metadata.plugins) {
        if (plugin.pluginName.toLowerCase().includes(queryLower)) {
            suggestions.push({ type: "plugin", name: plugin.pluginName });
        }
    }

    for (const [cmdName, entries] of metadata.commandIndex.entries()) {
        if (cmdName.includes(queryLower)) {
            suggestions.push({ type: "command", name: cmdName });
        }
    }

    return suggestions.slice(0, 5);
}

function isUserBotAdmin(userID) {
    if (!global.config || !global.config.facebook || !global.config.facebook.admin) return false;
    const adminConfig = global.config.facebook.admin;
    if (Array.isArray(adminConfig)) {
        return adminConfig.map(String).includes(String(userID));
    }
    return String(adminConfig) === String(userID);
}

function isUserGroupAdmin(userID, threadID) {
    if (!global.threadInfo || !global.threadInfo[threadID]) return false;
    const thread = global.threadInfo[threadID];
    if (thread.adminIDs) {
        if (Array.isArray(thread.adminIDs)) {
            return thread.adminIDs.some(admin => {
                if (typeof admin === "object" && admin !== null) {
                    return String(admin.id) === String(userID);
                }
                return String(admin) === String(userID);
            });
        }
    }
    return false;
}

function shouldShowCommand(commandEntry, senderID, threadID) {
    if (isUserBotAdmin(senderID)) return true;

    if (commandEntry.botAdminOnly || commandEntry.adminOnly) {
        return false;
    }

    if (commandEntry.groupAdminOnly) {
        return isUserGroupAdmin(senderID, threadID);
    }

    return true;
}

function safeReply(data, api, adv, text, callback) {
    if (adv && typeof adv.reply === "function") {
        return adv.reply(text, callback);
    }
    const apiSend = api["send" + "Message"];
    if (typeof apiSend === "function") {
        return apiSend.call(api, text, data.threadID, callback, data.messageID);
    }
}

function getArgs(data) {
    if (data && Array.isArray(data.args)) {
        return data.args.slice(1);
    }
    if (data && typeof data.body === "string" && data.body.trim()) {
        return data.body.trim().split(/\s+/);
    }
    return [];
}

function collectHelpMetadata() {
    const loadedCount = (global.plugins && global.plugins.Y2TB && global.plugins.Y2TB.plugins) ? Object.keys(global.plugins.Y2TB.plugins).length : 0;
    if (cache.metadata && cache.pluginCount === loadedCount) {
        return cache.metadata;
    }

    const plugins = [];
    const commandIndex = new Map();

    if (!global.plugins || !global.plugins.Y2TB || !global.plugins.Y2TB.plugins) {
        return { plugins, commandIndex };
    }

    const loadedPluginNames = Object.keys(global.plugins.Y2TB.plugins);

    for (const pluginName of loadedPluginNames) {
        const pluginMeta = global.plugins.Y2TB.plugins[pluginName];
        if (!pluginMeta || !pluginMeta.dirFile) continue;

        const pluginDir = path.dirname(pluginMeta.dirFile);
        const manifestPath = path.join(pluginDir, 'plugin.json');

        let pluginInfo = {};
        if (fs.existsSync(manifestPath)) {
            try {
                pluginInfo = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            } catch (e) {
                // Ignore
            }
        }

        const name = pluginInfo.pluginName || pluginName;
        const desc = pluginInfo.desc || {};
        const helpCategory = pluginInfo.helpCategory || null;

        const commands = [];

        if (pluginInfo.commandList) {
            for (const cmdName in pluginInfo.commandList) {
                const cmdMeta = pluginInfo.commandList[cmdName];
                const cmdEntry = {
                    name: cmdName,
                    mainFunc: cmdMeta.mainFunc || cmdName,
                    help: cmdMeta.help || {},
                    tag: cmdMeta.tag || {},
                    example: cmdMeta.example || {},
                    pluginName: name,
                    adminOnly: !!cmdMeta.adminOnly,
                    botAdminOnly: !!cmdMeta.botAdminOnly,
                    groupAdminOnly: !!cmdMeta.groupAdminOnly
                };
                commands.push(cmdEntry);
            }
        } else {
            for (const cmdName in global.plugins.Y2TB.command) {
                const cmdEntryGlobal = global.plugins.Y2TB.command[cmdName];
                if (cmdEntryGlobal.namePlugin === pluginName) {
                    const cmdEntry = {
                        name: cmdName,
                        mainFunc: cmdEntryGlobal.mainFunc || cmdName,
                        help: cmdEntryGlobal.help || {},
                        tag: cmdEntryGlobal.tag || {},
                        example: {},
                        pluginName: name,
                        adminOnly: false,
                        botAdminOnly: false,
                        groupAdminOnly: false
                    };
                    commands.push(cmdEntry);
                }
            }
        }

        const pluginEntry = {
            pluginName: name,
            normalizedName: name.toLowerCase().replace(/\s+/g, ""),
            desc,
            helpCategory,
            commands
        };

        plugins.push(pluginEntry);
    }

    plugins.sort((a, b) => a.pluginName.localeCompare(b.pluginName));

    for (const plugin of plugins) {
        const grouped = groupAliases(plugin.commands);
        plugin.commands = grouped;

        for (const cmd of plugin.commands) {
            if (!commandIndex.has(cmd.name.toLowerCase())) {
                commandIndex.set(cmd.name.toLowerCase(), []);
            }
            commandIndex.get(cmd.name.toLowerCase()).push(cmd);

            if (Array.isArray(cmd.aliases)) {
                for (const alias of cmd.aliases) {
                    if (!commandIndex.has(alias.toLowerCase())) {
                        commandIndex.set(alias.toLowerCase(), []);
                    }
                    commandIndex.get(alias.toLowerCase()).push(cmd);
                }
            }
        }
    }

    cache.pluginCount = loadedCount;
    cache.metadata = { plugins, commandIndex };
    return cache.metadata;
}

function groupAliases(commands) {
    const result = [];
    const mainFuncToPrimary = new Map();

    for (const cmd of commands) {
        if (!mainFuncToPrimary.has(cmd.mainFunc)) {
            cmd.aliases = [];
            mainFuncToPrimary.set(cmd.mainFunc, cmd);
            result.push(cmd);
        } else {
            const primary = mainFuncToPrimary.get(cmd.mainFunc);
            primary.aliases.push(cmd.name);
        }
    }
    return result;
}

function t(adv, key, replaceObj, defaultVal) {
    let text = defaultVal;
    if (adv && adv.lang && adv.lang[key]) {
        const lang = adv.iso639 || (global.config && global.config.bot_info && global.config.bot_info.lang) || "vi_VN";
        if (adv.lang[key][lang] !== undefined) {
            text = adv.lang[key][lang];
        } else if (adv.lang[key]["vi_VN"] !== undefined) {
            text = adv.lang[key]["vi_VN"];
        } else if (adv.lang[key]["en_US"] !== undefined) {
            text = adv.lang[key]["en_US"];
        }
    }
    if (replaceObj && typeof replaceObj === "object") {
        for (const k in replaceObj) {
            text = text.split(k).join(replaceObj[k]);
        }
    }
    return text;
}

function isPositiveIntegerText(value) {
    return /^[1-9]\d*$/.test(String(value || "").trim());
}

function getInferredCategory(plugin, lang) {
    if (plugin.helpCategory) {
        return getLocalizedValue(plugin.helpCategory, lang);
    }

    const pluginNameLower = plugin.pluginName.toLowerCase();
    const commandNames = plugin.commands.map(c => c.name.toLowerCase());

    for (const rule of CATEGORY_RULES) {
        if (rule.key === "other") continue;
        for (const pattern of rule.match) {
            if (pluginNameLower.includes(pattern)) {
                return lang === "vi_VN" ? rule.vi : rule.en;
            }
            for (const cmdName of commandNames) {
                if (cmdName.includes(pattern)) {
                    return lang === "vi_VN" ? rule.vi : rule.en;
                }
            }
        }
    }

    const otherRule = CATEGORY_RULES.find(r => r.key === "other");
    return lang === "vi_VN" ? otherRule.vi : otherRule.en;
}

function getCategoryPriority(catName, lang) {
    const idx = CATEGORY_RULES.findIndex(r => {
        return (lang === "vi_VN" && r.vi === catName) || (lang !== "vi_VN" && r.en === catName);
    });
    return idx === -1 ? 999 : idx;
}

function getCategoryEmoji(catName, lang) {
    const rule = CATEGORY_RULES.find(r => {
        return (lang === "vi_VN" && r.vi === catName) || (lang !== "vi_VN" && r.en === catName);
    });
    if (rule && CATEGORY_EMOJIS[rule.key]) {
        return CATEGORY_EMOJIS[rule.key];
    }
    return "📦";
}

function validatePage(page, totalPages, data, api, adv) {
    if (page > totalPages || page < 1) {
        const errText = t(adv, "pageOutOfRange", { "{totalPages}": String(totalPages) }, `Trang không hợp lệ. Hiện chỉ có ${totalPages} trang.`);
        safeReply(data, api, adv, errText);
        return false;
    }
    return true;
}

module.exports = {
    main
};
