module.exports = function(RED) {
  'use strict';

  var request = require('request');
  var uuid = require('node-uuid');

  var DEFAULT_MAX_STEPS = 5;
  var CALLBACK_TIMEOUT_MS = 10000;

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

  function WitAppNode(n) {
    RED.nodes.createNode(this,n);

    // Config options passed by Node RED
    this.name = n.name;
    this.token = n.token;

    // Config node states
    this.subscriptions = {};
    this.users = {};

    this.req = request.defaults({
      baseUrl: process.env.WIT_URL || 'https://api.wit.ai',
      strictSSL: false,
      json: true,
      headers: {
        'Authorization': 'Bearer ' + n.token,
      }
    });

    var node = this;

    this.register = function(witNode) {
      node.users[witNode.id] = witNode;
    };

    this.deregister = function(witNode, done) {
      delete node.users[witNode.id];
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

  }

  RED.nodes.registerType('wit-app', WitAppNode);

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

  function WitActionInNode(n) {
    RED.nodes.createNode(this,n);

    this.app = RED.nodes.getNode(n.app);
    var node = this;

    if(!this.app) {
      this.error(RED._('Missing Wit App'));
      return;
    }

    this.actionType = n.acionType;

  }

  RED.nodes.registerType('wit-action-in', WitActionInNode);

  function WitActionOutNode(n) {
    RED.nodes.createNode(this,n);

    this.app = RED.nodes.getNode(n.app);
    var node = this;

    if(!this.app) {
      this.error(RED._('Missing Wit App'));
      return;
    }

    this.actionType = n.acionType;
  }

  RED.nodes.registerType('wit-action-out', WitActionOutNode);


};