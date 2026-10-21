
window.__tcfapi = function (command, version, callback, parameter) {
    if (command === 'getTCData' || command === 'addEventListener' || command === 'removeEventListener') {
        const tcData = {
            gdprApplies: false,
            tcString: '',
            eventStatus: 'tcloaded',
            cmpId: 299,
            cmpVersion: 10,
            cmpStatus: 'disabled',
            isServiceSpecific: true,
            useNonStandardStacks: false,
            purposeOneTreatment: false,
            purpose: {
                consents: {},
                legitimateInterests: {}
            },
            vendor: {
                consents: {},
                legitimateInterests: {}
            }
        };
        callback(tcData, true);
    } else if (command === 'ping') {
        callback({
            gdprApplies: false,
            cmpId: 299,
            cmpVersion: 10,
            cmpStatus: 'disabled'
        }, true);
    } else {
        callback(null, false);
    }
};
window.dispatchEvent(new Event('tcfapiready'));