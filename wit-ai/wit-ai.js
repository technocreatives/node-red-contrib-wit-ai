module.exports = function(RED) {
  'use strict';

  var request = require('request');
  var uuid = require('node-uuid');

  var DEFAULT_MAX_STEPS = 5;
  var CALLBACK_TIMEOUT_MS = 10000;

// -------------------------------------------------------
// Utility 

  var makeWitResponseHandler = function(endpoint, node, cb) {
    var handler = function(error, response, data) {
      var err = error || 
        data.error ||
        response.statusCode !== 200 && data.body + ' (' + response.statusCode + ')'
      ;

      if(err) {
        node.error(RED._('[' + endpoint + '] Error: ' + err));
        if(cb) {
          process.nextTick(function(){
            cb(err);
          });
        }
        return;
      }
      if(cb) {
        process.nextTick(function(){
          cb(null, data);
        });
      }
    };

    return handler;
  };

  var makeCallbackTimeout = function(node, ms){
    return setTimeout(function(){
      node.warn(RED._('I didn\'t get the callback after ' + (ms / 1000) + ' seconds. Did you forget to call me back?'));
    }, ms);
  };

  var cbIfActionMissing = function(actions, action, cb){
    if (!actions.hasOwnProperty(action)) {
      if (cb) {
        process.nextTick(function(){
          cb('No \'' + action + '\' action found.');
        });
      }
      return true;
    }
    return false;
  };

  var clone = function(obj){
    const newObj = {};
    Object.keys(obj).forEach(function(k){
      newObj[k] = typeof obj[k] === 'object' ? clone(obj[k]) : obj[k];
    });
    return newObj;
  };

// -------------------------------------------------------
// App (config)

  function WitAppNode(n) {
    RED.nodes.createNode(this,n);

    // Config options passed by Node RED
    this.name = n.name;
    this.token = n.token;

    // Config node states
    this.actions = {};

    this.req = request.defaults({
      baseUrl: process.env.WIT_URL || 'https://api.wit.ai',
      strictSSL: false,
      json: true,
      headers: {
        'Authorization': 'Bearer ' + n.token,
      }
    });

    var node = this;

    this.register = function(action, witNode) {
      if(node.actions.hasOwnProperty(action)){
        node.warn(RED._('Node already registered for action ' + action));
        return false;
      }
      node.actions[action] = witNode;
      return true;
    };

    this.deregister = function(action, witNode, done) {
      if(node.actions.hasOwnProperty(action) && node.actions[action].id === witNode.id) {
        delete this.actions[action];
      }
      done();
    };

    this.message = function(message, cb) {
      var options = {
        uri: '/message',
        method: 'GET',
        qs: {q: message}
      };
      node.req(options, makeWitResponseHandler('message', node, cb));
    };

    this.converse = function(sessionId, message, context, cb){
      const options = {
        uri: '/converse',
        method: 'POST',
        qs: { 'session_id': sessionId },
        json: context,
      };
      if (message) {
        options.qs.q = message;
      }
      this.req(options, makeWitResponseHandler('converse', node, cb));
    };

    var makeCallback = function(i, sessionId, message, context, cb){

      return function(error, json){
        error = error || !json.type && 'Couldn\'t find type in Wit response';
        if (error) {
          if (cb) {
            process.nextTick(function(){
              cb(error);
            });
          }
          return;
        }

        var clonedContext = clone(context);

        if (json.type === 'stop') {
          // End of turn
          if (cb) {
            process.nextTick(function(){
              cb(null, context);
            });
          }
          return;
        } else if (json.type === 'msg') {
          if (cbIfActionMissing(node.actions, 'say', cb)) {
            return;
          }
          node.log(RED._('Executing say with message: ' + json.msg));
          node.actions.say.send({
            context: clonedContext,
            sessionId: sessionId,
            payload: json.msg
          });
          if (i <= 0) {
            node.warn(RED._('Max steps reached, halting.'));
            if (cb) {
              cb(null, context);
            }
            return;
          }

          // Retrieving action sequence
          node.converse(
            sessionId,
            null,
            context,
            makeCallback(--i, sessionId, message, context, cb)
          );
        } else if (json.type === 'merge') {
          if (cbIfActionMissing(node.actions, 'merge', cb)) {
            return;
          }
          node.log(RED._('Executing merge action'));
          node.actions.merge.send({
            _steps: --i,
            _actionType: json.type, 
            sessionId: sessionId, 
            context: clonedContext, 
            entities: json.entities, 
            payload: message
          });
          // TODO. store a timeout to warn if no one picks up this msg
          // timeoutID = makeCallbackTimeout(CALLBACK_TIMEOUT_MS);
          return;

        } else if (json.type === 'action') {
          var action = json.action;
          if (cbIfActionMissing(node.actions, action, cb)) {
            return;
          }
          node.log(RED._('Executing action: ' + action));
          node.actions[action].send({
            _steps: --i,
            _actionType: json.type, 
            _action: action,
            sessionId: sessionId, 
            context: clonedContext, 
            payload: message
          });
          // TODO. store a timeout to warn if no one picks up this msg
          // timeoutID = makeCallbackTimeout(CALLBACK_TIMEOUT_MS);
          return;

        } else { // error
          if (cbIfActionMissing(node.actions, 'error', cb)) {
            return;
          }
          node.log('Executing error action');
          var err = new Error('Oops, I don\'t know what to do.');
          node.actions.error.send({sessionId:sessionId, context:clonedContext, payload:err});
          return;
        }

      };
    };

    this.runConversation = function(sessionId, message, context, maxSteps){
      var steps = maxSteps ? maxSteps : DEFAULT_MAX_STEPS;
      node.converse(
        sessionId,
        message,
        context,
        makeCallback(steps, sessionId, message, context, function(error){
          if(error) {
            node.error(RED._('Conversation failed: ' + error));
          }
        })
      );
    };

    this.response = function(msg) {
      if(msg._steps <= 0) {
        node.warn(RED._('Max steps reached, halting.'));
        return;
      }
      node.runConversation(msg.sessionId, null, msg.context, msg._steps);
    };

  }
  RED.nodes.registerType('wit-app', WitAppNode);

// -------------------------------------------------------
// Message 

  function WitMessageNode(n) {
    RED.nodes.createNode(this,n);

    this.app = RED.nodes.getNode(n.app);
    var node = this;

    if(!this.app) {
      this.error(RED._('Missing Wit App'));
      return;
    }

    this.on('input', function(msg){
      node.app.message(msg.payload.toString(), function(err, data){
        if(err) {
          return;
        }
        msg.payload = data;
        node.send(msg);
      });
    });

    this.app.register(this);

    this.on('close', function(done){
      if(!this.app) {
        return done();
      }
      node.deregister(node, done);
    });
  }
  RED.nodes.registerType('wit-message', WitMessageNode);

// -------------------------------------------------------
// Converse 

  function WitConverseNode(n) {
    RED.nodes.createNode(this,n);

    this.app = RED.nodes.getNode(n.app);
    var node = this;

    if(!this.app) {
      this.error(RED._('Missing Wit App'));
      return;
    }

    this.on('input', function(msg){
      msg.sessionId = msg.sessionId || uuid.v1();
      msg.context = msg.context || {};
      node.app.runConversation(msg.sessionId, msg.payload, msg.context);
    });

  }
  RED.nodes.registerType('wit-converse', WitConverseNode);

// -------------------------------------------------------
// Merge 

  function WitMergeNode(n) {
    RED.nodes.createNode(this,n);

    this.app = RED.nodes.getNode(n.app);
    var node = this;

    if(!this.app) {
      this.error(RED._('Missing Wit App'));
      return;
    }
    if(this.app.register('merge', this)){
      node.status({fill:'green',shape:'dot',text:'registered'});
    } else {
      node.status({fill:'red',shape:'dot',text:'already registered'});
    }
    this.on('close', function(done) {
      node.app.deregister('merge',node,done);
    });


  }
  RED.nodes.registerType('wit-merge', WitMergeNode);

// -------------------------------------------------------
// Action 

  function WitActionNode(n) {
    RED.nodes.createNode(this,n);

    this.app = RED.nodes.getNode(n.app);
    var node = this;

    if(!this.app) {
      this.error(RED._('Missing Wit App'));
      return;
    }

    this.action = n.action;
    if(this.app.register(this.action, this)){
      node.status({fill:'green',shape:'dot',text:'registered'});
    } else {
      node.status({fill:'red',shape:'dot',text:'already registered'});
    }
    this.on('close', function(done) {
      node.app.deregister(node.action,node,done);
    });

  }
  RED.nodes.registerType('wit-action', WitActionNode);

// -------------------------------------------------------
// Response 

  function WitResponse(n) {
    RED.nodes.createNode(this,n);

    this.app = RED.nodes.getNode(n.app);

    if(!this.app) {
      this.error(RED._('Missing Wit App'));
      return;
    }

    this.on('input', function(msg){
      this.app.response(msg);
    });

  }
  RED.nodes.registerType('wit-response', WitResponse);

// -------------------------------------------------------
// Say 

  function WitSayNode(n) {
    RED.nodes.createNode(this,n);

    this.app = RED.nodes.getNode(n.app);
    var node = this;

    if(!this.app) {
      this.error(RED._('Missing Wit App'));
      return;
    }
    if(this.app.register('say', this)){
      node.status({fill:'green',shape:'dot',text:'registered'});
    } else {
      node.status({fill:'red',shape:'dot',text:'already registered'});
    }
    this.on('close', function(done) {
      node.app.deregister('say',node,done);
    });

  }
  RED.nodes.registerType('wit-say', WitSayNode);

// -------------------------------------------------------
// Error 

  function WitErrorNode(n) {
    RED.nodes.createNode(this,n);

    this.app = RED.nodes.getNode(n.app);
    var node = this;

    if(!this.app) {
      this.error(RED._('Missing Wit App'));
      return;
    }

    if(this.app.register('error', this)){
      node.status({fill:'green',shape:'dot',text:'registered'});
    } else {
      node.status({fill:'red',shape:'dot',text:'already registered'});
    }
    this.on('close', function(done) {
      node.app.deregister('error',node,done);
    });

  }
  RED.nodes.registerType('wit-error', WitErrorNode);


};