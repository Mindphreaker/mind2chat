var appInfo = {
	name: 'Mind.Chat 1',
	id: 'mindphreaker.mind.chat1',
	version: '0.1.2',
	vendor: 'Mindphreaker',
}
var appConfig = null;
var appConversations = null;

let access = {
	_public: ['Read', 'Insert']
};

var vm = new Vue({
	el: '#appContainer',
	data: {
		loginSuccessful: false,
		username: 'Stranger'
	}
});

var vModalRegister = new Vue({el: '#registerModal'});
var vModalNewConversation = new Vue({el: '#newConversationModal'});

$(document).ready(function() {
	auth();
});

var appContainer = null;
var authenticatedAppHandle = null;

async function auth() {
	appContainer = 'apps/' + appInfo.id;
	setStatus('Connecting...');
	let appHandle = await window.safeApp.initialise(appInfo);
	let authURI = await window.safeApp.authorise(appHandle, access, {own_container: true});
	await window.safeApp.connectAuthorised(appHandle, authURI);

	setAppHandle(appHandle);
	console.log('Authorised app handle: ' + appHandle);
	setStatus('Connected!');

	//setting up app
	setup();
}

async function setup() {
	let appHandle = getAppHandle();
	let ownContainerHandle = await getOwnContainerHandle();
	//try to fetch existing user id
	try {
		console.log('loading appConfig...');
		let appConfigSerial = await getDecryptedValueAsStringFromPlaintextKey(ownContainerHandle, 'app_config');
		appConfig = JSON.parse(appConfigSerial);

		if (appConfig) {
			console.log('Already set up!');
			await login();
		}
	} catch (e) {
		//no app config exists yet, create it...
		let userIdStr = generateUserId();

		//generate encryption keys...
		let encKeyPairHandle = await window.safeCrypto.generateEncKeyPair(appHandle);
		let pubEncKeyHandle = await window.safeCryptoKeyPair.getPubEncKey(encKeyPairHandle);
		let rawPubEncKey = await window.safeCryptoPubEncKey.getRaw(pubEncKeyHandle);

		let secEncKeyHandle = await window.safeCryptoKeyPair.getSecEncKey(encKeyPairHandle);
		let rawSecEncKey = await window.safeCryptoPubEncKey.getRaw(secEncKeyHandle);

		let appConfigObj = {
			app: appInfo.name,
			version: appInfo.version,
			userId: userIdStr,
			pubEncKey: uint8ArrayToCommaString(rawPubEncKey.buffer),
			secEncKey: uint8ArrayToCommaString(rawSecEncKey.buffer)
		};
		let appConfigSerial = JSON.stringify(appConfigObj);
		console.log(appConfigSerial);
		await insertValue(appHandle, ownContainerHandle, 'app_config', appConfigSerial, true);
		appConfig = appConfigObj;

		//setup conversations
		let appConversationsObj = {};
		let appConversationsSerial = JSON.stringify(appConversationsObj);
		await insertValue(appHandle, ownContainerHandle, 'app_conversations', appConversationsSerial, true);
		appConversations = appConversationsObj;

		console.log('Setup complete!');

		$('#registerModal').modal('show');
	}

}

function startBackgroundCheck() {
	console.log('starting background checks');
	setInterval(function(){
		//check for new messages
		let targetUserId = $('#editor').data('user');
		console.log('checking for new messages from: ' + targetUserId);
		loadConversation(targetUserId);
	}, 5000);

	setInterval(function(){
		//check for new messages
		console.log('checking inbox for new conversations...');
		loadConversationList();
	}, 10000);
}

async function login() {
	console.log('logging in...');
	setStatus('Fetching user data...');
	let userData = await getUserData(appConfig.userId);
	if (userData) {
		setStatus('Connected.');
		vm.username = userData.username;
		vm.loginSuccessful = true;

		startBackgroundCheck();

		await loadConversationList(true);
	} else {
		setStatus('Please register a username!');
		$('#registerModal').modal('show');
	}
}

async function register() {
	console.log('register()');
	let appHandle = getAppHandle();
	let username = $('#registerUsernameInput').val();
	if (!username) {
		return false;
	}

	//generate new user id
	let userId = getCurrentUserId();

	try {
		//create user alias container
		let userAliasData = {
			app: appInfo.name,
			version: appInfo.version,
			userId: userId
		};
		let userAliasContainerHandle = await getUserAliasContainerHandle(username);
		let userAliasDataString = JSON.stringify(userAliasData);
		//try to create user-alias (fails if user already exists)
		await insertValue(appHandle, userAliasContainerHandle, 'user_alias_data', userAliasDataString);

		//create public account info data for this user
		let userData = {
			app: appInfo.name,
			version: appInfo.version,
			userId: userId,
			username: username,
			pubEncKey: appConfig.pubEncKey
		};
		let userContainerHandle = await getUserContainerHandle(userId);
		let userDataString = JSON.stringify(userData);
		console.log(userDataString);
		await insertValue(appHandle, userContainerHandle, 'user_data', userDataString);

		//create message inbox md
		let userInboxContainerHandle = await getUserInboxContainerHandle(userId, true);

		await login();

		$('#registerModal').modal('hide');
	} catch(e) {
		alert('User already exists!');
	}
}

async function startConversation() {
	let username = $('#chatUserInput').val();
	if (!username) {
		return false;
	}
	$('#chatUserInput').val(''); //clear input again
	let userAliasData = await getUserIdByName(username);
	if (!userAliasData) {
		alert('User not found!');
		return false;
	}
	$('#newConversationModal').modal('hide');

	let targetUserId = userAliasData.userId;
	addConversationToInterface(targetUserId, username);
	await loadConversation(targetUserId, true);
}

function addConversationToInterface(targetUserId, username) {
	if (!$('#conversation_' + targetUserId).length) {
		$('#conversationList').append('<div id="conversation_' + targetUserId + '" class="col-12 conversation-item" data-user="' + targetUserId + '"><a href="#" onclick="loadConversation(\'' + targetUserId + '\', true); return false;">' + username + '</a></div>');
		return true;
	}
	return false;
}

async function sendMessage() {
	let appHandle = getAppHandle();
	let message = $('#editorInput').val();
	$('#editorInput').val(''); //clear input

	let targetUserId = $('#editor').data('user');
	console.log('send message to:');
	let targetUserData = await getUserData(targetUserId);
	console.log(targetUserData);

	let userInboxContainerHandle = await getUserInboxContainerHandle(targetUserId);

	//encrypt message
	let rawPubEncKey = commaStringToUint8Array(targetUserData.pubEncKey);
	let pubEncKeyHandle = await window.safeCrypto.pubEncKeyKeyFromRaw(appHandle, rawPubEncKey);
	let sealedMessage = await window.safeCryptoPubEncKey.encryptSealed(pubEncKeyHandle, message);

	let messageId = generateRandomString();
	addMessageToInterface(vm.username, messageId, message);
	let messageData = {
		id: messageId,
		sourceId: appConfig.userId,
		content: uint8ArrayToCommaString(sealedMessage)
	};

	let messageDataString = JSON.stringify(messageData);
	await insertValue(appHandle, userInboxContainerHandle, generateRandomString(), messageDataString);
	console.log('saved msg to target inbox, adding to appConversations...');

	await addMessageToConversations(targetUserData, messageData.id, messageData.sourceId, message);
}

function getConversationFromConversations(targetUserData) {
	let conversation = null;
	let targetUserId = targetUserData.userId;
	if (targetUserId in appConversations) {
		//load existing conversation
		conversation = appConversations[targetUserId];
		console.log('fetched existing conversation');
	} else {
		conversation = {
			userData: targetUserData,
			messages: {}
		};
		//add to conversation list
		appConversations[targetUserId] = conversation;
	}
	return conversation;
}

async function addMessageToConversations(targetUserData, messageId, sourceId, content) {
	let messageData = {
		id: messageId,
		sourceId: sourceId,
		content: content
	};

	//fetch existing or create new conversation
	let conversation = getConversationFromConversations(targetUserData);
	if (messageData.id in conversation.messages) {
		//message already stored to conversation
		return false;
	}

	console.log('adding new message to conversations!');
	console.log(targetUserData);
	console.log(conversation);
	conversation.messages[messageData.id] = messageData;
	appConversations[targetUserData.userId] = conversation;

	console.log('storing appConversations');
	let appHandle = getAppHandle();
	let ownContainerHandle = await getOwnContainerHandle();
	console.log(appConversations);
	let appConversationsSerial = JSON.stringify(appConversations);
	console.log(appConversationsSerial);
	await updateValue(appHandle, ownContainerHandle, 'app_conversations', appConversationsSerial, true);

}

async function addNewConversationsFromInbox() {
	console.log('check inbox for new conversations...');
	let userInboxContainerHandle = await getUserInboxContainerHandle(appConfig.userId);
	let messages = await getEntries(userInboxContainerHandle);
	for (messageId in messages) {
		let messageValue = messages[messageId].buf;
		let messageDataStr = decodeBuffer(messageValue);
		if (messageDataStr !== '_root') {
			console.log(messageDataStr);
			let messageData = JSON.parse(messageDataStr);
			let userData = await getUserData(messageData.sourceId);
			//fetch existing or create new conversation
			let conversation = getConversationFromConversations(userData);
		}
	}
}

async function loadConversationList(loadFirstConversation) {
	let appHandle = getAppHandle();

	if (appConversations === null) {
		console.log('loading appConversations from ownContainer...');
		console.log('appConversations: ' + appConversations);
		let ownContainerHandle = await getOwnContainerHandle();
		let appConversationsSerial = await getDecryptedValueAsStringFromPlaintextKey(ownContainerHandle, 'app_conversations');
		appConversations = JSON.parse(appConversationsSerial);

		if (!appConversations) {
			return false;
		}
	}

	//check for new conversations from inbox
	await addNewConversationsFromInbox();

	let conversation = null;
	let i = 0;
	let firstUserId = null;
	for (let targetUserId in appConversations) {
		i++;
		conversation = appConversations[targetUserId];
		addConversationToInterface(targetUserId, conversation.userData.username);
		if (i === 1) {
			firstUserId = targetUserId;
		}
	}

	if (loadFirstConversation) {
		//load the first conversation
		loadConversation(firstUserId);
	}
}

function addMessageToInterface(username, messageId, plaintextMessageString) {
	if (!$('#msg_' + messageId).length) {
		$('#messages').append('<div id="msg_' + messageId + '">' + username + ': ' + plaintextMessageString + '</div>');
	}
}

async function loadConversation(targetUserId, clearExistingMessages) {
	if (!targetUserId) {
		return false;
	}

	if (clearExistingMessages) {
		$('#messages').html('');
	}

	$('.conversation-item').removeClass('active');
	$('#conversation_' + targetUserId).addClass('active');
	$('#editor').data('user', targetUserId);
	if (!$('.modal').is(':visible')) {
		$('#editorInput').focus();
	}

	let appHandle = getAppHandle();
	let ownUserId = getCurrentUserId();
	let targetUserData = await getUserData(targetUserId);
	if (!targetUserData) {
		alert('User not found!');
		return false;
	}

	//check messages from inbox
	let userInboxContainerHandle = await getUserInboxContainerHandle(appConfig.userId);
	let messages = await getEntries(userInboxContainerHandle);
	for (messageId in messages) {
		let messageValue = messages[messageId].buf;
		let messageDataStr = decodeBuffer(messageValue);

		if (messageDataStr !== '_root') {
			console.log(messageDataStr);
			let messageData = JSON.parse(messageDataStr);

			let sourceId = messageData.sourceId;
			if (sourceId == targetUserId) {
				console.log('decrypt message...');
				let plaintextMessage = await decryptMessageFromCommaString(messageData.content);
				console.log(plaintextMessage);
				await addMessageToConversations(targetUserData, messageData.id, messageData.sourceId, plaintextMessage);
			}
		}
	}

	//load conversation from object
	console.log('loading messages from appConversations object...');

	let conversation = appConversations[targetUserId];
	if (!conversation || !conversation.hasOwnProperty('messages')) {
		return false;
	}

	for (messageId in conversation.messages) {
		let messageData = conversation.messages[messageId];

		if (targetUserData.userId == messageData.sourceId) {
			addMessageToInterface(targetUserData.username, messageData.id, messageData.content);
		} else {
			addMessageToInterface(vm.username, messageData.id, messageData.content);
		}

	}

}

async function decryptMessageFromCommaString(commaStringMessage) {
	let appHandle = getAppHandle();
	let rawPubEncKey = commaStringToUint8Array(appConfig.pubEncKey);
	let rawSecEncKey = commaStringToUint8Array(appConfig.secEncKey);
	let encKeyPairHandle = await window.safeCrypto.generateEncKeyPairFromRaw(appHandle, rawPubEncKey, rawSecEncKey);
	let plaintextMessageBuffer = await window.safeCryptoKeyPair.decryptSealed(encKeyPairHandle, commaStringToUint8Array(commaStringMessage));
	return decodeBuffer(plaintextMessageBuffer);
}

async function getUserData(userId) {
	let appHandle = getAppHandle();
	let userContainerHandle = await getUserContainerHandle(userId);
	let userData = null;
	try {
		let userDataSerial = await getValueString(userContainerHandle, 'user_data');
		userData = JSON.parse(userDataSerial);
		if (userData) {
			console.log('Found user!');
			console.log(userData);
		}
	} catch(e) {
		console.log('No user found!');
	}
	return userData;
}

async function saveUserData(userData) {
	let appHandle = getAppHandle();
	let userContainerHandle = await getUserContainerHandle(userId);
	let userDataString = JSON.stringify(messageData);
	updateValue(appHandle, userContainerHandle, 'user_data', userDataString);
	return userData;
}

async function getUserIdByName(username) {
	let appHandle = getAppHandle();
	let userAliasContainerHandle = await getUserAliasContainerHandle(username);
	let userAliasData = null;
	try {
		let userAliasDataSerial = await getValueString(userAliasContainerHandle, 'user_alias_data');
		userAliasData = JSON.parse(userAliasDataSerial);
		if (userAliasData) {
			console.log('Found user!');
			console.log(userAliasData);
		}
	} catch(e) {
		console.log('No user found!');
	}
	return userAliasData;
}

function generateUserId() {
	let date = new Date();
	let userId = Sha3.hash512(date + generateRandomString());
	return userId;
}

function getCurrentUserId() {
	if (!appConfig || appConfig.userId === null) {
		throw 'Error: Uninitialised appConfig or missing user id!';
	}
	return appConfig.userId;
}

function getUserContainerName(userId) {
	return appInfo.id + '_user_' + userId;
}

async function getUserContainerHandle(userId) {
	let appHandle = getAppHandle();
	//the hash/name of the MD which stores user data-objects
	let userContainerName = getUserContainerName(userId);
	let userContainerHandle = await createPublic(appHandle, userContainerName);
	return userContainerHandle;
}

function getUserAliasContainerName(username) {
	return appInfo.id + '_user_alias_' + username;
}

async function getUserAliasContainerHandle(username) {
	let appHandle = getAppHandle();
	//the hash/name of the MD which stores user data-objects
	let userAliasContainerName = getUserAliasContainerName(username);
	let userAliasContainerHandle = await createPublic(appHandle, userAliasContainerName);
	return userAliasContainerHandle;
}

async function getUserInboxContainerHandle(userId, init) {
	let appHandle = getAppHandle();
	//the hash/name of the MD which stores user data-objects
	let userInboxContainerName = appInfo.id + '_user_inbox_' + userId;
	let userInboxContainerHandle = null;
	if (init) {
		userInboxContainerHandle = await createPublic(appHandle, userInboxContainerName, ['Insert'], 'user_inbox_data', '_root');
	} else {
		userInboxContainerHandle = await createPublic(appHandle, userInboxContainerName);
	}
	return userInboxContainerHandle;
}

// Helper functions

async function getOwnContainerHandle() {
	let appHandle = getAppHandle();
	return await getContainer(appHandle, appContainer);
}

function generateRandomString() {
	return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

function getAppHandle() {
	return authenticatedAppHandle;
}

function setAppHandle(h) {
	authenticatedAppHandle = h;
}

function setStatus(s) {
	$('#status').html(s);
}
