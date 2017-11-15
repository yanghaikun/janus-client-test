$(function(){
 var client = new Client();
 client.init();
});

function Client() {
var server = "ws://localhost:8188"
var iceServers = [{urls: "stun:stun.l.google.com:19302"}];
var iceTransportPolicy;
var bundlePolicy;
var ipv6Support = false;

var ws = null;
var wsHandlers = {};
var wsKeepaliveTimeoutId = null;

var sessionId = null;
var transactions = {};
var connected = false;

this.init = function(){
    createSession();
}

function randomString(len) {
	var charSet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	var randomString = '';
	for (var i = 0; i < len; i++) {
		var randomPoz = Math.floor(Math.random() * charSet.length);
		randomString += charSet.substring(randomPoz,randomPoz+1);
	}
	return randomString;
}

function createSession() {
    console.log("create session...");
    var transaction = randomString(12);
    var request = { "janus": "create", "transaction": transaction };
    ws = new WebSocket(server, 'janus-protocol');
    wsHandlers = {
        'error': function() {
            console.log("Error connecting to the Janus WebSockets server: Is the gateway down?");
        },

        'open': function() {
            // We need to be notified about the success
            transactions[transaction] = function(json) {
                console.log(json);
                if (json["janus"] !== "success") {
                    console.log("Ooops: " + json["error"].code + " " + json["error"].reason);	// FIXME
                    console.log(json["error"].reason);
                    return;
                }
                wsKeepaliveTimeoutId = setTimeout(keepAlive, 30000);
                connected = true;
                sessionId = json.data["id"];
                console.log("Created session: " + sessionId);
            };
            ws.send(JSON.stringify(request));
        },

        'message': function(event) {
            console.log("get message...");
            handleEvent(JSON.parse(event.data));
        },

        'close': function() {
            if (server === null || !connected) {
                return;
            }
            connected = false;
            // FIXME What if this is called when the page is closed?
            console.log("Lost connection to the gateway (is it down?)");
        }
    };


    //添加ws监听
    for(var eventName in wsHandlers) {
        ws.addEventListener(eventName, wsHandlers[eventName]);
    }

    ws.onmessage = function(event) {
        console.log("got message");
    }
}

// Private event handler: this will trigger plugin callbacks, if set
function handleEvent(json) {
    retries = 0;
    if(json["janus"] === "keepalive") {
        // Nothing happened
        console.log("Got a keepalive on session " + sessionId);
        return;
    } else if(json["janus"] === "ack") {
        // Just an ack, we can probably ignore
        console.log("Got an ack on session " + sessionId);
        console.log(json);
        var transaction = json["transaction"];
        if(transaction !== null && transaction !== undefined) {
            var reportSuccess = transactions[transaction];
            if(reportSuccess !== null && reportSuccess !== undefined) {
                reportSuccess(json);
            }
            delete transactions[transaction];
        }
        return;
    } else if(json["janus"] === "success") {
        // Success!
        console.log("Got a success on session " + sessionId);
        console.log(json);
        var transaction = json["transaction"];
        if(transaction !== null && transaction !== undefined) {
            var reportSuccess = transactions[transaction];
            if(reportSuccess !== null && reportSuccess !== undefined) {
                reportSuccess(json);
            }
            delete transactions[transaction];
        }
        return;
    } else if(json["janus"] === "webrtcup") {
        // The PeerConnection with the gateway is up! Notify this
        console.log("Got a webrtcup event on session " + sessionId);
        console.log(json);
        var sender = json["sender"];
        if(sender === undefined || sender === null) {
            console.log("Missing sender...");
            return;
        }
        var pluginHandle = pluginHandles[sender];
        if(pluginHandle === undefined || pluginHandle === null) {
            console.log("This handle is not attached to this session");
            return;
        }
        pluginHandle.webrtcState(true);
        return;
    } else if(json["janus"] === "hangup") {
        // A plugin asked the core to hangup a PeerConnection on one of our handles
        console.log("Got a hangup event on session " + sessionId);
        console.log(json);
        var sender = json["sender"];
        if(sender === undefined || sender === null) {
            console.log("Missing sender...");
            return;
        }
        var pluginHandle = pluginHandles[sender];
        if(pluginHandle === undefined || pluginHandle === null) {
            console.log("This handle is not attached to this session");
            return;
        }
        pluginHandle.webrtcState(false, json["reason"]);
        pluginHandle.hangup();
    } else if(json["janus"] === "detached") {
        // A plugin asked the core to detach one of our handles
        console.log("Got a detached event on session " + sessionId);
        console.log(json);
        var sender = json["sender"];
        if(sender === undefined || sender === null) {
            console.log("Missing sender...");
            return;
        }
        var pluginHandle = pluginHandles[sender];
        if(pluginHandle === undefined || pluginHandle === null) {
            // Don't warn here because destroyHandle causes this situation.
            return;
        }
        pluginHandle.detached = true;
        pluginHandle.ondetached();
        pluginHandle.detach();
    } else if(json["janus"] === "media") {
        // Media started/stopped flowing
        console.log("Got a media event on session " + sessionId);
        console.log(json);
        var sender = json["sender"];
        if(sender === undefined || sender === null) {
            console.log("Missing sender...");
            return;
        }
        var pluginHandle = pluginHandles[sender];
        if(pluginHandle === undefined || pluginHandle === null) {
            console.log("This handle is not attached to this session");
            return;
        }
        pluginHandle.mediaState(json["type"], json["receiving"]);
    } else if(json["janus"] === "slowlink") {
        console.log("Got a slowlink event on session " + sessionId);
        console.log(json);
        // Trouble uplink or downlink
        var sender = json["sender"];
        if(sender === undefined || sender === null) {
            console.log("Missing sender...");
            return;
        }
        var pluginHandle = pluginHandles[sender];
        if(pluginHandle === undefined || pluginHandle === null) {
            console.log("This handle is not attached to this session");
            return;
        }
        pluginHandle.slowLink(json["uplink"], json["nacks"]);
    } else if(json["janus"] === "error") {
        // Oops, something wrong happened
        Janus.error("Ooops: " + json["error"].code + " " + json["error"].reason);	// FIXME
        console.log(json);
        var transaction = json["transaction"];
        if(transaction !== null && transaction !== undefined) {
            var reportSuccess = transactions[transaction];
            if(reportSuccess !== null && reportSuccess !== undefined) {
                reportSuccess(json);
            }
            delete transactions[transaction];
        }
        return;
    } else if(json["janus"] === "event") {
        console.log("Got a plugin event on session " + sessionId);
        console.log(json);
        var sender = json["sender"];
        if(sender === undefined || sender === null) {
            console.log("Missing sender...");
            return;
        }
        var plugindata = json["plugindata"];
        if(plugindata === undefined || plugindata === null) {
            console.log("Missing plugindata...");
            return;
        }
        console.log("  -- Event is coming from " + sender + " (" + plugindata["plugin"] + ")");
        var data = plugindata["data"];
        console.log(data);
        var pluginHandle = pluginHandles[sender];
        if(pluginHandle === undefined || pluginHandle === null) {
            console.log("This handle is not attached to this session");
            return;
        }
        var jsep = json["jsep"];
        if(jsep !== undefined && jsep !== null) {
            console.log("Handling SDP as well...");
            console.log(jsep);
        }
        var callback = pluginHandle.onmessage;
        if(callback !== null && callback !== undefined) {
            console.log("Notifying application...");
            // Send to callback specified when attaching plugin handle
            callback(data, jsep);
        } else {
            // Send to generic callback (?)
            console.log("No provided notification callback");
        }
    } else {
        console.log("Unkown message/event  '" + json["janus"] + "' on session " + sessionId);
        console.log(json);
    }
}

}
