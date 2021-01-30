import asyncio
import json
from typing import Set, Dict

import websockets
from rlbot.messages.flat.GameTickPacket import GameTickPacket
from rlbot.messages.flat.PlayerInputChange import PlayerInputChange
from rlbot.messages.flat.PlayerSpectate import PlayerSpectate
from rlbot.socket.socket_manager_asyncio import SocketRelayAsyncio


class SampleScript:

    def __init__(self):
        self.socket_relay = SocketRelayAsyncio()
        self.connected_websockets: Set[websockets.WebSocketServerProtocol] = set()
        self.round_active = False
        self.focused_player_index = 0
        self.players_list = []

    def send_dict(self, data: Dict):
        data_string = json.dumps(data)
        self.connected_websockets = {s for s in self.connected_websockets if s.open}
        for socket in self.connected_websockets:
            asyncio.create_task(socket.send(data_string))

    def handle_spectate(self, spectate: PlayerSpectate, seconds: float, frame_num: int):
        print(f'Spectating player index {spectate.PlayerIndex()}')
        self.focused_player_index = spectate.PlayerIndex()
        self.send_dict({
            'spectating': spectate.PlayerIndex()
        })

    def handle_packet(self, packet: GameTickPacket):
        active = packet.GameInfo().IsRoundActive()
        if active and not self.round_active:
            players = []
            for i in range(packet.PlayersLength()):
                p = packet.Players(i)
                players.append({'name': p.Name().decode('utf-8')})

            self.players_list = players
            self.send_dict({
                'players': players
            })
        self.round_active = active

    def input_change(self, change: PlayerInputChange, seconds: float, frame_num: int):
        if change.PlayerIndex() == self.focused_player_index:
            cs = change.ControllerState()
            self.send_dict({
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

    def run(self):
        self.socket_relay.player_spectate_handlers.append(self.handle_spectate)
        self.socket_relay.player_input_change_handlers.append(self.input_change)
        self.socket_relay.packet_handlers.append(self.handle_packet)

        relay_future = self.socket_relay.connect_and_run(wants_quick_chat=True, wants_game_messages=True,
                                                         wants_ball_predictions=True)
        start_server = websockets.serve(self.handle_connection, "localhost", 8765)
        asyncio.get_event_loop().run_until_complete(start_server)
        asyncio.get_event_loop().run_until_complete(relay_future)
        asyncio.get_event_loop().run_forever()

    async def handle_connection(self, websocket, path):
        self.connected_websockets.add(websocket)
        self.send_dict({
            'spectating': self.focused_player_index
        })
        self.send_dict({
            'players': self.players_list
        })
        async for message in websocket:
            print(message)


# You can use this __name__ == '__main__' thing to ensure that the script doesn't start accidentally if you
# merely reference its module from somewhere
if __name__ == '__main__':
    print("Socket script starting...")
    script = SampleScript()
    script.run()
