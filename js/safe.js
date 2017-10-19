const typeTag = 15000;

function decodeBuffer(buffer) {
	return new TextDecoder("utf-8").decode(buffer);
}

function uint8ArrayToCommaString(b) {
	return new Uint8Array(b).join();
}
function commaStringToUint8Array(s) {
	return new Uint8Array(s.split(','));
}

async function requestSharedMdPermission(appHandle, hashedName, permission) {
	var hashedName = await sha3Hash(appHandle, mdName);
	await window.safeApp.authoriseShareMd(
		appHandle,
		[{
			type_tag: 15001,
			name: new Uint8Array(hashedName),
			perms: ['Insert'],
		}]
	);
}

async function addPermissions(appHandle, mdHandle, permissions, appSignKeyHandle) {
	if (!permissions) {
		return false;
	}
	console.log('Adding permissions...');
	console.log(permissions);
	let pmSetHandle = await window.safeMutableData.newPermissionSet(appHandle);

	permissions.forEach(async function(permission) {
		console.log('Permission ' + permission);
		await window.safeMutableDataPermissionsSet.setAllow(pmSetHandle, permission);
	});

	let version = await window.safeMutableData.getVersion(mdHandle);
	let result = await window.safeMutableData.setUserPermissions(mdHandle, appSignKeyHandle, pmSetHandle, version + 1);
	console.log('Added permissions!');
	return result;
}

async function removePermissions(appHandle, mdHandle, permissions, appSignKeyHandle) {
	if (!permissions) {
		return false;
	}
	console.log('Removing permissions...');
	console.log(permissions);
	let pmSetHandle = await window.safeMutableData.newPermissionSet(appHandle);
	permissions.forEach(async function(permission) {
		console.log('Permission ' + permission);
		await window.safeMutableDataPermissionsSet.setDeny(pmSetHandle, permission);
	});
	let version = await window.safeMutableData.getVersion(mdHandle);
	let result = await window.safeMutableData.setUserPermissions(mdHandle, appSignKeyHandle, pmSetHandle, version + 1);
	console.log('Removed permissions!');
	return result;
}

async function sha3Hash(appHandle, input) {
	let h = await window.safeCrypto.sha3Hash(appHandle, input);
	console.log('Hashed (' + input + '):');
	console.log(decodeBuffer(h));
 	return h;
 }

 async function getRandomName(appHandle) {
 	let mdName = generateRandomString();
  	let hashedName = await sha3Hash(appHandle, mdName);
 	return hashedName;
 }

 async function getContainer(appHandle, containerName) {
 	return await window.safeApp.getContainer(appHandle, containerName);
 }

async function updateValue(appHandle, mdHandle, key, value, toEncrypt) {

	let keyToInsert = key;
    let valToInsert = value;

	if (toEncrypt) {
		keyToInsert = await window.safeMutableData.encryptKey(mdHandle, key);
		valToInsert = await window.safeMutableData.encryptValue(mdHandle, value);
	}

	let mutationHandle = await window.safeMutableData.newMutation(appHandle);

	let oldValue = await window.safeMutableData.get(mdHandle, keyToInsert);
	await window.safeMutableDataMutation.update(mutationHandle, keyToInsert, valToInsert, oldValue.version + 1);
	let result = await window.safeMutableData.applyEntriesMutation(mdHandle, mutationHandle);
	await window.safeMutableDataMutation.free(mutationHandle);

	return result;

}

async function insertValue(appHandle, mdHandle, key, value, toEncrypt) {
	let keyToInsert = key;
    let valToInsert = value;

	if (toEncrypt) {
		keyToInsert = await window.safeMutableData.encryptKey(mdHandle, key);
		valToInsert = await window.safeMutableData.encryptValue(mdHandle, value);
	}

	let mutationHandle = await window.safeMutableData.newMutation(appHandle);
	await window.safeMutableDataMutation.insert(mutationHandle, keyToInsert, valToInsert);
	let result = await window.safeMutableData.applyEntriesMutation(mdHandle, mutationHandle);
	await window.safeMutableDataMutation.free(mutationHandle);

	return result;
}

async function getValue(mdHandle, key) {
	let v = await window.safeMutableData.get(mdHandle, key);
	return v;
}

async function getValueString(mdHandle, key) {
	let v = await getValue(mdHandle, key);
	let valueStr = decodeBuffer(v.buf);
	return valueStr;
}

/*
 * PUBLIC MUTABLE DATA
 */

 async function getPublicHandle(appHandle, mdName) {
 	let hashedName = await sha3Hash(appHandle, mdName);
 	let mdHandle = await window.safeMutableData.newPublic(appHandle, hashedName, typeTag);
 	console.log('public handle: ' + mdHandle);
 	return mdHandle;
 }

async function createPublic(appHandle, mdName, permissions, key, value) {
	let mdHandle = await getPublicHandle(appHandle, mdName);
	try {
		await window.safeMutableData.quickSetup(mdHandle);
		console.log('md setup complete!');

		//adding public permissions
		await addPermissions(appHandle, mdHandle, permissions, null);

		console.log('MutableData created, handle: ' + mdHandle);
		if (key) {
			await insertValue(appHandle, mdHandle, key, value);
			console.log('inserting ' + value + ' into ' + key);
		}
	} catch (e) {
		console.log('NOTICE: ' + e);
	}
	return mdHandle;
}

/*
 * PRIVATE MUTABLE DATA
 */

async function createRandomPrivate(appHandle, key, value) {
	let hashedName = await getRandomName(appHandle);
	let nonce = await window.safeCrypto.generateNonce(appHandle);

 	let pubEncKeyHandle = await window.safeCrypto.getAppPubEncKey(appHandle);
 	let rawAppPubEncKey = await window.safeCryptoPubEncKey.getRaw(pubEncKeyHandle);

 	//create and fill MD
 	let mdHandle = await window.safeMutableData.newPrivate(appHandle, hashedName, 15001, rawAppPubEncKey.buffer, nonce.buffer);
	console.log('Random private handle: ' + mdHandle);

	try {
		await window.safeMutableData.quickSetup(mdHandle);
		console.log('Random private MD created!');

		if (key) {
		 	let encryptedKey = await window.safeMutableData.encryptKey(mdHandle, key);
		 	let encryptedValue = await window.safeMutableData.encryptValue(mdHandle, value);
		 	let mutationHandle = await window.safeMutableData.newMutation(appHandle);
		 	await window.safeMutableDataMutation.insert(mutationHandle, encryptedKey, encryptedValue);
		 	await window.safeMutableData.applyEntriesMutation(mdHandle, mutationHandle);
		}
	} catch(e) {

	}

 	return mdHandle;
}

 async function createPrivate(appHandle, mdName, key, value) {
 	let hashedName = await sha3Hash(appHandle, mdName);
 	let nonce = await window.safeCrypto.generateNonce(appHandle);

 	let pubEncKeyHandle = await window.safeCrypto.getAppPubEncKey(appHandle);
 	let rawAppPubEncKey = await window.safeCryptoPubEncKey.getRaw(pubEncKeyHandle);

 	//create and fill MD
 	let mdHandle = await window.safeMutableData.newPrivate(appHandle, hashedName, 15001, rawAppPubEncKey.buffer, nonce.buffer);
	console.log('Handle (' + mdName + '): ' + mdHandle);

	try {
		await window.safeMutableData.quickSetup(mdHandle);
		console.log('Private MD created!');

		if (key) {
		 	let encryptedKey = await window.safeMutableData.encryptKey(mdHandle, key);
		 	let encryptedValue = await window.safeMutableData.encryptValue(mdHandle, value);
		 	let mutationHandle = await window.safeMutableData.newMutation(appHandle);
		 	await window.safeMutableDataMutation.insert(mutationHandle, encryptedKey, encryptedValue);
		 	await window.safeMutableData.applyEntriesMutation(mdHandle, mutationHandle);
		}
	} catch(e) {

	}

 	return mdHandle;
 };

 async function getPrivateHandle(appHandle, mdName) {
 	let hashedName = await sha3Hash(appHandle, mdName);
 	let nonce = await window.safeCrypto.generateNonce(appHandle);

 	let pubEncKeyHandle = await window.safeCrypto.getAppPubEncKey(appHandle);
 	let rawAppPubEncKey = await window.safeCryptoPubEncKey.getRaw(pubEncKeyHandle);

 	let mdHandle = await window.safeMutableData.newPrivate(appHandle, hashedName, 15001, rawAppPubEncKey.buffer, nonce.buffer);
 	console.log('private handle: ' + mdHandle);
 	return mdHandle;
 }

 async function insertPrivateValue(appHandle, mdHandle, key, value) {
 	return await insertValue(appHandle, mdHandle, key, value, true);
 }

async function getDecryptedValueFromEncryptedKey(mdHandle, encryptedKey) {
	let encryptedValue = await window.safeMutableData.get(mdHandle, encryptedKey);
	return await window.safeMutableData.decrypt(mdHandle, encryptedValue.buf);
}

async function getDecryptedValueFromPlaintextKey(mdHandle, plaintextKey) {
	let encryptedKey = await window.safeMutableData.encryptKey(mdHandle, plaintextKey);
	return await getDecryptedValueFromEncryptedKey(mdHandle, encryptedKey);
}

async function getDecryptedValueAsStringFromPlaintextKey(mdHandle, plaintextKey) {
	let v = await getDecryptedValueFromPlaintextKey(mdHandle, plaintextKey);
	let valueStr = decodeBuffer(v);
	console.log(plaintextKey + ' => ' + valueStr);
	return valueStr;
}

async function getDecryptedValueAsStringFromEncryptedKey(mdHandle, encryptedKey) {
	let v = await getDecryptedValueFromEncryptedKey(mdHandle, encryptedKey);
	let valueStr = decodeBuffer(v);
	return valueStr;
}

async function getDecryptedStringFromBuffer(mdHandle, buffer) {
	let d = await window.safeMutableData.decrypt(mdHandle, buffer);
	let str = decodeBuffer(d);
	return str;
}

async function useEntriesForCallback(mdHandle, callback) {
	let entriesHandle = await window.safeMutableData.getEntries(mdHandle);
	await window.safeMutableDataEntries.forEach(entriesHandle, (k, v) => {
		callback(k, v);
	});
}

async function getEntries(mdHandle) {
	let entriesHandle = await window.safeMutableData.getEntries(mdHandle);
	let entries = {};
	await window.safeMutableDataEntries.forEach(entriesHandle, (k, v) => {
		entries[k] = v;
	});
	return entries;
}

async function testSerial(appHandle, mdName) {
	getPublicHandle('test123').then(testMDHandle => {
		window.safeMutableData.serialise(testMDHandle).then(serial => {
			console.log(decodeBuffer(serial));

			createPublic(appHandle, mdName, [], 'key1', serial).then(mdHandle => {

				console.log('Serial container handle: ' + mdHandle);
				testSerialFetch(mdHandle);

			});

		});
	});
}

async function testSerialFetch(appHandle, mdHandle) {
	getValue(mdHandle, 'key1').then(v => {
		let fetchedSerialValue = v.buf;
		console.log('fetched serial value:');
		console.log(v.buf);
		window.safeMutableData.fromSerial(appHandle, fetchedSerialValue).then(fetchedHandleFromSerial => {
			console.log('fetched handle from serial: ' + fetchedHandleFromSerial);
			useEntriesForCallback(fetchedHandleFromSerial, function(k, v){console.log(decodeBuffer(v.buf));});
		});
	});
}
