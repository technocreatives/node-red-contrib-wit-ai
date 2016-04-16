node-red-contrib-wit-ai
==============================

<a href="http://nodered.org" target="_new">Node-RED</a> nodes to integrate with <a href="http://wit.ai" target="_new">Wit.ai</a>.

Install
-------

Run the following command in your Node-RED user directory - typically `~/.node-red`

        npm install node-red-contrib-wit-ai

Make sure you have an account and an app at https://wit.ai/. You will need the `Server Access Token` that can be found in the Settings menu of your Wit.ai app.

Wit.ai API conformance
----------------------

20160330

https://wit.ai/docs/http/20160330

Usage
-----

Provides these nodes:

Note: One each of __Merge__, __Say__ and __Error__ are required to be in the flow. Also, one __Action__ node for each defined action is required.

### Wit Message

Takes a sentence and returns the meaning.

Expects the `payload` to be a `String`.

Uses wit.ai's `/message` endpoint.

Does not yet support the `context`, `msg_id`, `thread_id`, and `n` parameters.

### Wit Converse

This is the node where you send a question or statement to your Wit.ai bot. Typically you would hook this up to a messaging app like Slack or Facebook Messanger.

You can provide a `sessionId` and a `context` along with the `payload`. If not, they will be created for you.

After the __Converse__ node has been given a message, the __Merge__, __Action__ and __Say__ nodes will trigger.

### Wit Merge

For each configured Wit.ai bot you must provide one single __Merge__ node. After a message has been sent to the bots __Converse__ node, the __Merge__ node will trigger and send a message with a `context` and `entities`.

Attach a __Function__ node to the merge node and modify the provided `context` depending on the recieved `entities`.

The __Function__ node must then send the message along to a __Response__ node configured for the same Wit.ai bot as the __Merge__ node where the message originated.

Its best if you keep the same `msg` object through your flow, so to not loose any meta information stored by the Wit.ai bot.

### Wit Action

If you have configured an action in any of your Wit.ai stories, you need to create an __Action__ node in your flow with the same action name.

This node will be triggered if the conversation identifies this action.

Like the __Merge__ node, you should let the message from an __Action__ node continue to a __Response__ node. Modify the `msg` object, but don't replace it.

You can only have one __Action__ node for each action on a bot.

### Wit Response

A __Response__ node takes the message from a __Merge__ or __Action__ node and makes sure the conversation continues.


### Wit Say

The __Say__ node is triggered when the bot has something to say. Typically you would forward the `payload` to a messaging system like Slack or Facebook Messanger.

### Wit Error

The __Error__ node outputs any errors that was enconuntered during the conversation. This could be forwarded to a messaging system.

### Sample Flow

TBD

