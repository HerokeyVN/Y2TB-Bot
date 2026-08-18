function normal () {
	return{
    	"bot_info": {
    		"botname": "Y2TBbot",
    		"lang": "en_US"
    	},
    	"facebook": {
    		"FBemail": "",
    		"FBpassword": "",
    		"prefix": "/",
    		"admin": [],
    		"autoMarkRead": true,
    		"selfListen": false,
    		"UIDmode": "disabled",
    		"blackList": [],
    		"whiteList": []
    	}
    }
}

function core() {
	return{
    	"main_bot": {
    		"dataSaveTime": "5",
    		"developMode": false,
    		"toggleLog": true,
    		"toggleDebug": false
    	},
    	"facebook": {
    		"logLevel": "error",
    		"userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36",
    		"listenEvents": true,
	    	"updatePresence": false,
	    	"enableE2EE": false,
	    	"e2eeAutoConnect": true,
	    	"e2eeDeviceStorePath": "config/device-store.json",
	    	"e2eeSessionStorePath": "config/e2ee_session.json",
	    	"e2eeDevicePath": "config/e2ee_device.json"
    	},
    	"update": {
    		"auto": false
    	}
    }
}

module.exports = {
	normal,
	core
}
