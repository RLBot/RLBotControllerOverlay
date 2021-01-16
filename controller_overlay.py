from typing import Set

from rlbot.agents.base_agent import SimpleControllerState
from rlbot.messages.flat.PlayerInputChange import PlayerInputChange
from rlbot.messages.flat.PlayerSpectate import PlayerSpectate
from rlbot.messages.flat.PlayerStatEvent import PlayerStatEvent
from rlbot.socket.socket_manager_asyncio import SocketRelayAsyncio
import asyncio
import websockets
import json

class SampleScript:

    def __init__(self):
        self.socket_relay = SocketRelayAsyncio()
        self.connected_websockets: Set[websockets.WebSocketServerProtocol] = set()

    def handle_spectate(self, spectate: PlayerSpectate, seconds: float, frame_num: int):
        print(f'Spectating player index {spectate.PlayerIndex()}')
        # Make the bot jump whenever we start spectating them >:)
        controls = SimpleControllerState()
        controls.jump = True
        self.socket_relay.send_player_input(spectate.PlayerIndex(), controls)

    def handle_stat(self, stat: PlayerStatEvent, seconds: float, frame_num: int):
        stat_value = stat.StatType().decode('utf-8')
        print(f'Stat player index {stat.PlayerIndex()}: {stat_value}')

    def input_change(self, change: PlayerInputChange, seconds: float, frame_num: int):
        cs = change.ControllerState()
        data = json.dumps({
            'idx': change.PlayerIndex(),
            'ctrl': {
                'jm': 1 if cs.Jump() else 0,
                'st': cs.Steer(),
                'th': cs.Throttle(),
                'pt': cs.Pitch(),
                'yw': cs.Yaw(),
                'rl': cs.Roll(),
                'bs': 1 if cs.Boost() else 0,
                'hb': 1 if cs.Handbrake() else 0,
                'us': 1 if cs.UseItem() else 0
            }
        })

        self.connected_websockets = {s for s in self.connected_websockets if s.open}
        for socket in self.connected_websockets:
            asyncio.create_task(socket.send(data))
        if change.ControllerState().Jump():
            print(f'Player index {change.PlayerIndex()} is jumping!')

    def run(self):
        self.socket_relay.player_spectate_handlers.append(self.handle_spectate)
        self.socket_relay.player_stat_handlers.append(self.handle_stat)
        self.socket_relay.player_input_change_handlers.append(self.input_change)

        relay_future = self.socket_relay.connect_and_run(wants_quick_chat=True, wants_game_messages=True, wants_ball_predictions=True)
        start_server = websockets.serve(self.handle_connection, "localhost", 8765)
        asyncio.get_event_loop().run_until_complete(start_server)
        asyncio.get_event_loop().run_until_complete(relay_future)
        asyncio.get_event_loop().run_forever()


    async def handle_connection(self, websocket, path):
        self.connected_websockets.add(websocket)
        async for message in websocket:
            print(message)



# You can use this __name__ == '__main__' thing to ensure that the script doesn't start accidentally if you
# merely reference its module from somewhere
if __name__ == '__main__':
    print("Socket script starting...")
    script = SampleScript()
    script.run()
