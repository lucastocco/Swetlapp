const https = require('https');
const Alexa = require('ask-sdk');
const {actionFactory} = require("./src/utils/ActionFactory");
const {getDatabaseInstance, buildDatabaseParams} = require("./src/DatabaseInteractor");
const {phraseGenerator} = require("./src/utils/PhraseGenerator");
const appName = 'SwetlApp';

const LaunchRequestHandler = {
    canHandle(handlerInput) {
        return handlerInput.requestEnvelope.request.type === 'LaunchRequest';
    },
    async handle(handlerInput) {
        const { accessToken } = handlerInput.requestEnvelope.context.System.user;
        let speechText = '';

        if (!accessToken) {
            speechText = phraseGenerator("no_auth");
            return handlerInput.responseBuilder
                .speak(speechText)
                .withLinkAccountCard()
                .getResponse();
        }
        try {
            let tokenOptions = buildHttpGetOptions(accessToken);

            let response = await httpGet(tokenOptions);
            //console.log({ response });
            //console.log('Username:' + response.username);
            //console.log('Id:' + response.id);
            handlerInput.attributesManager.getSessionAttributes().name = response.given_name || response.username;
            handlerInput.attributesManager.getSessionAttributes().username = response.username;
        }
        catch (error) {
            console.log(`Error message: ${error.message}`);
        }

        speechText = phraseGenerator("start",handlerInput.attributesManager.getSessionAttributes().name);
            return handlerInput.responseBuilder
                .speak(speechText)
                .reprompt(speechText)
                .withSimpleCard(appName,speechText)
                .getResponse();
        //}
    }
};

//Helper Function for calling the Cognito /oauth2/userInfo to get user info using the accesstoken
function buildHttpGetOptions(accessToken) {
    return {
        //Replace the host with your cognito user pool domain
        host: 'swetlapp.auth.eu-central-1.amazoncognito.com',
        port: 443,
        path: '/oauth2/userInfo',
        method: 'GET',
        headers: {
            'authorization': 'Bearer ' + accessToken
        }
    };
}

function httpGet(options) {
    return new Promise(((resolve, reject) => {
        let request = https.request(options, (response) => {
            response.setEncoding('utf8');
            let returnData = '';

            if (response.statusCode < 200 || response.statusCode >= 300) {
                return reject(new Error(`${response.statusCode}: ${response.req.getHeader('host')} ${response.req.path}`));
            }

            response.on('data', (chunk) => {
                returnData += chunk;
            });

            response.on('end', () => {
                //console.log({ returnData });
                resolve(JSON.parse(returnData));
            });

            response.on('error', (error) => {
                reject(error);
            });
        });
        request.end();
    }));
}

function getWF(username, idWF) {
    let params = buildDatabaseParams(
        "User-tevi37ekkbfvjgpusicgsjpt5m-testcog",
        "workflow",
        "id",
        username
    );

    return getDatabaseInstance().query(params).then(
        data => {
            if(data.Count === 0) return null;

            let hit = data.Items[0].workflow.find(i => i.name === idWF);

            if (hit) return hit.def;

            return null;
        },
        () => null
    );
}

const RunWorkflowHandler = {
    canHandle(handlerInput) {
        let request = handlerInput.requestEnvelope.request;
        return request.type === 'IntentRequest' 
        	&& request.intent.name === 'RunWorkflowIntent' 
            && request.dialogState === 'STARTED'
            && request.intent.slots.workflow;
    },
    async handle(handlerInput) {
    	console.log("entro in RunWork");
    	let request = handlerInput.requestEnvelope.request;
        let workflowName = request.intent.slots.workflow.value;
        let speechText = '';
        const attributi = handlerInput.attributesManager.getSessionAttributes();
        let username = attributi.username;
        let response;
        //console.log(request.intent);
        let check = {
        		output: '',
        		slotReq: 'DEFAULT'
        };
        let actionList;
        await getWF(username, workflowName).then(
            data =>  {actionList = JSON.parse(data); console.log(data); }
        );
        
        speechText += phraseGenerator("start_WF",workflowName);
        let i=0;
        for(; i<actionList.actions_records.length && check.slotReq=='DEFAULT'; i++) {
            let action = actionList.actions_records[i];
            //console.log("Esecuzione azione: " + action.action);
            try {
            	check = await actionFactory(action.action, action.params).run();
                //speechText += await actionFactory(action.action, action.params).run();
            	speechText += check.output+ " ";
            } catch (e) {
                console.log("error: " + e);
                speechText += "Azione non riconosciuta";
            }
        }
        //se check.slotReq è diverso da DEFAULT allora di sicuro non ho finito il WF e devo continuare il dialogo con l'utente
        if(check.slotReq!='DEFAULT'){
        	
	        //salvo la lista di azioni	        
        	attributi.actionList = actionList;
	        
	        //salvo la posizione
        	attributi.index = --i;	        	
	        
		    //salvo il nome dello slot richiesto
        	attributi.slotName = check.slotReq;
		    
	        //il dialogo diventa IN_PROGRESS
	        request.dialogState = 'IN_PROGRESS';
	        
	        //la risposta si aspetta che l'utente dia un valore per elicitSlot
	        try{
	        response = handlerInput.responseBuilder
            .speak(speechText)
            .reprompt(speechText)
            .addElicitSlotDirective(check.slotReq,request.intent)
            .withSimpleCard(appName,speechText)
            .getResponse();
	        }catch(e){
	        	console.log(e.message);
	        	response = handlerInput.responseBuilder
	            .speak(speechText)
	            .reprompt(speechText)
	            .withSimpleCard(appName,speechText)
	            .getResponse();	        	
	        }
        }else{
        	response = handlerInput.responseBuilder
            .speak(speechText)
            .reprompt(speechText)
            .withSimpleCard(appName,speechText)
            .getResponse();
        }
        return response;
    }
};

const InProgressRunWorkflowHandler = {
    canHandle(handlerInput) {
        let request = handlerInput.requestEnvelope.request;
        return request.type === 'IntentRequest' && request.dialogState === 'IN_PROGRESS'
            && handlerInput.attributesManager.getSessionAttributes().slotName !== 'undefined';
    },
    async handle(handlerInput) {
    	let request = handlerInput.requestEnvelope.request;
    	const attributi = handlerInput.attributesManager.getSessionAttributes();
    	let elicitSlot = '';
    	if(attributi.slotName=='confirmitionSlot' || attributi.slotName=='channelSchedule'){
    		if(request.intent.slots[attributi.slotName].resolutions.resolutionsPerAuthority[0].status.code=="ER_SUCCESS_MATCH"){
    			elicitSlot = request.intent.slots[attributi.slotName].resolutions.resolutionsPerAuthority[0].values[0].value.name;
    		}else{
    			return handlerInput.responseBuilder
                .speak("Scusa non ho capito, puoi ripetere la risposta?")
                .reprompt("Scusa non ho capito, puoi ripetere la risposta?")
                .addElicitSlotDirective(attributi.slotName,request.intent)
                .withSimpleCard(appName,speechText)
                .getResponse();
    		}
    	}else{
    		elicitSlot = request.intent.slots[attributi.slotName].value;
    	}
        if(elicitSlot=='undefined'){
        	return handlerInput.responseBuilder
            .speak("Scusa non ho capito, puoi ripetere?")
            .reprompt("Scusa non ho capito, puoi ripetere?")
            .addElicitSlotDirective(attributi.slotName,request.intent)
            .withSimpleCard(appName,speechText)
            .getResponse();
        } 
        	console.log(elicitSlot);
        let actionList = attributi.actionList;
        let i = attributi.index;
        let check = {
        		output: '',
        		slotReq: 'DEFAULT'
        };
        let speechText = '';
        let response;
        
        if(elicitSlot){
        	actionList.actions_records[i].params.push(elicitSlot);
        	//faccio partire il WF solo se ho ottenuto una risposta giusta
        	for(; i<actionList.actions_records.length && check.slotReq=='DEFAULT'; i++) {
	            let action = actionList.actions_records[i];
	            //console.log("Esecuzione azione: " + action.action);
	            try {
	            	check = await actionFactory(action.action, action.params).run();
	                //speechText += await actionFactory(action.action, action.params).run();
	            	speechText += check.output+ " ";
	            } catch (e) {
	                console.log("in prog error: " + e);
	                speechText += "Azione non riconosciuta";
	            }
	        }
        }else{
        	let speechText = 'Scusa, puoi ripetere?';
        }      
        console.log("esco dal for");
        if(check.slotReq!='DEFAULT'){
	        //salvo la lista di azioni
        	attributi.actionList = actionList;
	        
	        //salvo la posizione
        	attributi.index = --i;
	        
	        //salvo il nome dello slot richiesto
        	attributi.slotName = check.slotReq;
	        
	        //il dialogo diventa IN_PROGRESS
	        request.dialogState = 'IN_PROGRESS';
	        
	        //la risposta si aspetta che l'utente dia un valore per elicitSlot
	        response = handlerInput.responseBuilder
            .speak(speechText)
            .reprompt(speechText)
            .addElicitSlotDirective(check.slotReq,request.intent)   
            .withSimpleCard(appName,speechText)  
            .getResponse();
        }else{
        	response = handlerInput.responseBuilder
            .speak(speechText)
            .reprompt(speechText)
            .withSimpleCard(appName,speechText)
            .getResponse();
        }
        return response;
    }
};

const WorkflowRepeatHandler = {
    canHandle(handlerInput){
        let request = handlerInput.requestEnvelope.request;
        return request.type === 'IntentRequest' && request.intent.name === 'RepeatWorkflowIntent';
    },
    handle(handlerInput) {
        let request = handlerInput.requestEnvelope.request;
        var workflowName =  request.intent.slots.workflow.value;
        const speechText = 'Va bene, ripeto il workflow' + workflowName;

        return handlerInput.responseBuilder
            .speak(speechText)
            .reprompt(speechText)
            .withSimpleCard(appName, speechText)
            .getResponse();
    }
};

const StopIntentHandler = {
    canHandle(handlerInput) {
        let request = handlerInput.requestEnvelope.request;
        return request.type === 'IntentRequest' && request.intent.name === 'AMAZON.StopIntent';
    },
    handle(handlerInput) {
        const speechText = 'A presto';

        return handlerInput.responseBuilder
            .speak(speechText)
            .withSimpleCard(appName, speechText)
            .getResponse();
    }
};

const CancelIntent = {
    canHandle(handlerInput) {
        let request = handlerInput.requestEnvelope.request;
        return request.type === 'IntentRequest' && request.intent.name === 'AMAZON.CancelIntent';
    },
    handle(handlerInput) {
        const speechText = 'Hai annullato il workflow.';
        const repromptText = 'Come posso aiutarti?';

        return handlerInput.responseBuilder
            .speak(speechText)
            .reprompt(repromptText)
            .withSimpleCard(appName, speechText)
            .getResponse();
    }
};

const HelpIntentHandler = {
    canHandle(handlerInput) {
        let request = handlerInput.requestEnvelope.request;
        return request.type === 'IntentRequest' && request.intent.name === 'AMAZON.HelpIntent';
    },
    handle(handlerInput) {
        const speechText = 'Puoi eseguire i workflow creati nell\'app, prova a dire: avvia Roberto';
        const repromptText = 'Prova a chiedermi di eseguire un workflow che hai creato nell\'app';

        return handlerInput.responseBuilder
            .speak(speechText)
            .reprompt(repromptText)
            .withSimpleCard(appName, speechText)
            .getResponse();
    }
};

const SessionEndedRequestHandler = {
    canHandle(handlerInput) {
        return handlerInput.requestEnvelope.request.type === 'SessionEndedRequest';
    },
    handle(handlerInput) {
        //any cleanup logic goes here
        return handlerInput.responseBuilder.getResponse();
    }
};

const ErrorHandler = {
    canHandle() {
        return true;
    },
    handle(handlerInput, error) {
        console.log(`Error handled: ${error.message}`);

        return handlerInput.responseBuilder
            .speak('Scusa, non ho capito. Puoi ripetere?')
            .reprompt('Non ho capito il comando. Prova a chiedere aiuto.')
            .getResponse();
    },
};

let skill;

exports.handler = async function (event, context) {
    //console.log(`REQUEST++++${JSON.stringify(event)}`);
    if (!skill) {
        skill = Alexa.SkillBuilders.standard()
            .addRequestHandlers(
                LaunchRequestHandler,
                RunWorkflowHandler,
                InProgressRunWorkflowHandler,
                WorkflowRepeatHandler,
                HelpIntentHandler,
                CancelIntent,
                StopIntentHandler,
                SessionEndedRequestHandler
            )
            .addErrorHandlers(ErrorHandler)
            .create();
    }

    const response = await skill.invoke(event, context);
    //console.log(`RESPONSE++++${JSON.stringify(response)}`);

    return response;
};