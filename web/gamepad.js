/**
 * Copyright 2012 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * @author mwichary@google.com (Marcin Wichary)
 */

var gamepadSupport = {
  // A number of typical buttons recognized by Gamepad API and mapped to
  // standard controls. Any extraneous buttons will have larger indexes.
  TYPICAL_BUTTON_COUNT: 16,

  // A number of typical axes recognized by Gamepad API and mapped to
  // standard controls. Any extraneous buttons will have larger indexes.
  TYPICAL_AXIS_COUNT: 4,

  // Whether we’re requestAnimationFrameing like it’s 1999.
  ticking: false,

  // The canonical list of attached gamepads, without “holes” (always
  // starting at [0]) and unified between Firefox and Chrome.
  gamepads: [],

  rawGamepads: [],

  focusedGamepadIndex: 0,

  // Remembers the connected gamepads at the last check; used in Chrome
  // to figure out when gamepads get connected or disconnected, since no
  // events are fired.
  prevRawGamepadTypes: [],

  // Previous timestamps for gamepad state; used in Chrome to not bother with
  // analyzing the polled data if nothing changed (timestamp is the same
  // as last time).
  prevTimestamps: [],

  /**
   * Initialize support for Gamepad API.
   */
  init: function() {
    gamepadSupport.rawGamepads[0] = {
      name: 'Unknown',
      playerIndex: 0,
      buttons: [0, 0, 0, 0, 0, 0, 0, 0],
      axes: [0, 0, 0, 0],
      timestamp: 0
    }
    gamepadSupport.startPolling();
  },

  connect: function () {
    var ws = new WebSocket("ws://127.0.0.1:8765/");

    ws.onmessage = function(event) {
      var data = JSON.parse(event.data);

      if (data.players) {
        for (var i = 0; i < data.players.length; i++) {
          var p = data.players[i];
          if (!gamepadSupport.rawGamepads[i]) {
            gamepadSupport.rawGamepads[i] = {
              name: p.name,
              playerIndex: i,
              buttons: [0, 0, 0, 0, 0, 0, 0, 0],
              axes: [0, 0, 0, 0],
              timestamp: 0
            }
          }
          gamepadSupport.rawGamepads[i].name = p.name;
        }
      } else if (Number.isInteger(data.spectating)) {
        gamepadSupport.focusedGamepadIndex = data.spectating;
      } else if (data.ctrl) {
        if (!gamepadSupport.rawGamepads[data.idx]) {
          gamepadSupport.rawGamepads[data.idx] = {
            name: 'Unknown',
            playerIndex: data.idx,
            buttons: [0, 0, 0, 0, 0, 0, 0, 0],
            axes: [0, 0, 0, 0],
            timestamp: 0
          }
        }
        var gamepad = gamepadSupport.rawGamepads[data.idx];
        var controls = data.ctrl;
        gamepad.buttons[0] = controls.jm;
        gamepad.buttons[1] = controls.bs;
        gamepad.buttons[2] = controls.hb;
        gamepad.buttons[3] = controls.us;
        gamepad.buttons[4] = -controls.th;
        gamepad.buttons[5] = controls.th;
        gamepad.axes[0] = controls.st || controls.yw;
        gamepad.axes[1] = controls.pt;
        gamepad.axes[2] = controls.rl;
        gamepad.timestamp += 1;
      }
    };

    ws.onclose = function(e) {
      console.log('Socket is closed. Reconnect will be attempted in 1 second.', e.reason);
      setTimeout(function() {
        gamepadSupport.connect();
      }, 1000);
    };

    ws.onerror = function(err) {
      console.error('Socket encountered error: ', err.message, 'Closing socket');
      ws.close();
    };
  },

  /**
   * Starts a polling loop to check for gamepad state.
   */
  startPolling: function() {

    tester.updateGamepads(gamepadSupport.gamepads);

    gamepadSupport.connect();

    // Don’t accidentally start a second loop, man.
    if (!gamepadSupport.ticking) {
      gamepadSupport.ticking = true;
      gamepadSupport.tick();
    }
  },

  /**
   * Stops a polling loop by setting a flag which will prevent the next
   * requestAnimationFrame() from being scheduled.
   */
  stopPolling: function() {
    gamepadSupport.ticking = false;
  },

  /**
   * A function called with each requestAnimationFrame(). Polls the gamepad
   * status and schedules another poll.
   */
  tick: function() {
    gamepadSupport.pollStatus();
    gamepadSupport.scheduleNextTick();
  },

  scheduleNextTick: function() {
    // Only schedule the next frame if we haven’t decided to stop via
    // stopPolling() before.
    if (gamepadSupport.ticking) {
      if (window.requestAnimationFrame) {
        window.requestAnimationFrame(gamepadSupport.tick);
      } else if (window.mozRequestAnimationFrame) {
        window.mozRequestAnimationFrame(gamepadSupport.tick);
      } else if (window.webkitRequestAnimationFrame) {
        window.webkitRequestAnimationFrame(gamepadSupport.tick);
      }
      // Note lack of setTimeout since all the browsers that support
      // Gamepad API are already supporting requestAnimationFrame().
    }
  },

  /**
   * Checks for the gamepad status. Monitors the necessary data and notices
   * the differences from previous state (buttons for Chrome/Firefox,
   * new connects/disconnects for Chrome). If differences are noticed, asks
   * to update the display accordingly. Should run as close to 60 frames per
   * second as possible.
   */
  pollStatus: function() {
    // Poll to see if gamepads are connected or disconnected. Necessary
    // only on Chrome.
    gamepadSupport.pollGamepads();

    for (var i = 0; i < gamepadSupport.gamepads.length; i++) {
      var gamepad = gamepadSupport.gamepads[i];

      // Don’t do anything if the current timestamp is the same as previous
      // one, which means that the state of the gamepad hasn’t changed.
      // This is only supported by Chrome right now, so the first check
      // makes sure we’re not doing anything if the timestamps are empty
      // or undefined.
      if (gamepad.timestamp &&
          (gamepad.timestamp === gamepadSupport.prevTimestamps[i])) {
        continue;
      }
      gamepadSupport.prevTimestamps[i] = gamepad.timestamp;

      gamepadSupport.updateDisplay(i);
    }
  },

  // This function is called only on Chrome, which does not yet support
  // connection/disconnection events, but requires you to monitor
  // an array for changes.
  pollGamepads: function() {
    var rawGamepads = gamepadSupport.rawGamepads;
    if (rawGamepads) {
      var rawGamepad = rawGamepads[gamepadSupport.focusedGamepadIndex];
      if (rawGamepad) {
        var currentName = '';
        if (gamepadSupport.gamepads.length) {
          currentName = gamepadSupport.gamepads[0].name;
        }
        gamepadSupport.gamepads = [rawGamepad];
        if (currentName !== rawGamepad.name) {
          tester.updateGamepads(gamepadSupport.gamepads);
        }
      }
    }
  },

  // Call the tester with new state and ask it to update the visual
  // representation of a given gamepad.
  updateDisplay: function(gamepadId) {
    var gamepad = gamepadSupport.gamepads[gamepadId];

    // Update all the buttons (and their corresponding labels) on screen.
    tester.updateButton(gamepad.buttons[0], gamepadId, 'button-1');
    tester.updateButton(gamepad.buttons[1], gamepadId, 'button-2');
    tester.updateButton(gamepad.buttons[2], gamepadId, 'button-3');
    tester.updateButton(gamepad.buttons[3], gamepadId, 'button-4');

    tester.updateButton(gamepad.buttons[4], gamepadId,
        'button-left-shoulder-top');
    tester.updateButton(gamepad.buttons[6], gamepadId,
        'button-left-shoulder-bottom');
    tester.updateButton(gamepad.buttons[5], gamepadId,
        'button-right-shoulder-top');
    tester.updateButton(gamepad.buttons[7], gamepadId,
        'button-right-shoulder-bottom');

    tester.updateButton(gamepad.buttons[8], gamepadId, 'button-select');
    tester.updateButton(gamepad.buttons[9], gamepadId, 'button-start');

    tester.updateButton(gamepad.buttons[10], gamepadId, 'stick-1');
    tester.updateButton(gamepad.buttons[11], gamepadId, 'stick-2');

    tester.updateButton(gamepad.buttons[12], gamepadId, 'button-dpad-top');
    tester.updateButton(gamepad.buttons[13], gamepadId, 'button-dpad-bottom');
    tester.updateButton(gamepad.buttons[14], gamepadId, 'button-dpad-left');
    tester.updateButton(gamepad.buttons[15], gamepadId, 'button-dpad-right');

    // Update all the analogue sticks.
    tester.updateAxis(gamepad.axes[0], gamepadId,
        'stick-1-axis-x', 'stick-1', true);
    tester.updateAxis(gamepad.axes[1], gamepadId,
        'stick-1-axis-y', 'stick-1', false);
    tester.updateAxis(gamepad.axes[2], gamepadId,
        'stick-2-axis-x', 'stick-2', true);
    tester.updateAxis(gamepad.axes[3], gamepadId,
        'stick-2-axis-y', 'stick-2', false);

    // Update extraneous buttons.
    var extraButtonId = gamepadSupport.TYPICAL_BUTTON_COUNT;
    while (typeof gamepad.buttons[extraButtonId] != 'undefined') {
      tester.updateButton(gamepad.buttons[extraButtonId], gamepadId,
          'extra-button-' + extraButtonId);

      extraButtonId++;
    }

    // Update extraneous axes.
    var extraAxisId = gamepadSupport.TYPICAL_AXIS_COUNT;
    while (typeof gamepad.axes[extraAxisId] != 'undefined') {
      tester.updateAxis(gamepad.axes[extraAxisId], gamepadId,
          'extra-axis-' + extraAxisId);

      extraAxisId++;
    }

  }
};
