# Wire protocol

This is the contract between the phone and the hem controller. The app's side
is in `src/core/protocol`. The reference behaviour for the controller is
`src/core/firmware/firmware.ts`, and `tests/firmware.test.ts` is its
acceptance suite.

All multi-byte values are little endian.

## Bluetooth LE layout

One custom service. The base UUID spells "WARM" in its first four bytes.

| Characteristic | UUID | Properties | Carries |
| --- | --- | --- | --- |
| Service | `5741524d-0001-4d55-9c1a-7a3e5f0b2d10` | | |
| Telemetry | `5741524d-0002-4d55-9c1a-7a3e5f0b2d10` | notify | Telemetry frames |
| Event | `5741524d-0003-4d55-9c1a-7a3e5f0b2d10` | notify | Event frames |
| Command | `5741524d-0004-4d55-9c1a-7a3e5f0b2d10` | write with response | Command frames |
| Ack | `5741524d-0005-4d55-9c1a-7a3e5f0b2d10` | notify | Ack frames |
| Info | `5741524d-0006-4d55-9c1a-7a3e5f0b2d10` | read | One Info frame |

The controller advertises a name beginning with `Warmup`.

## Frame envelope

Every message is one frame.

| Offset | Size | Field |
| --- | --- | --- |
| 0 | 1 | Start of frame, `0xA5` |
| 1 | 1 | Frame type |
| 2 | 1 | Sequence number, wraps at 255 |
| 3 | 1 | Payload length N, 0 to 240 |
| 4 | N | Payload |
| 4 + N | 2 | CRC-16/CCITT-FALSE of bytes 0 to 3 + N |

CRC-16/CCITT-FALSE: polynomial `0x1021`, initial value `0xFFFF`, no
reflection, no final XOR. The check value for ASCII `123456789` is `0x29B1`.

| Frame type | Value | Direction |
| --- | --- | --- |
| Telemetry | `0x01` | hoodie to phone |
| Event | `0x02` | hoodie to phone |
| Ack | `0x03` | hoodie to phone |
| Command | `0x10` | phone to hoodie |
| Info | `0x20` | hoodie to phone, on read |

A frame that fails its checksum is dropped. The controller answers a
malformed command frame with an Ack of `Invalid`.

## Units on the wire

| Quantity | Encoding |
| --- | --- |
| Temperature | signed 16-bit, hundredths of a degree Celsius |
| Fraction (charge, duty, health) | unsigned 8-bit, 0 to 200, half-percent steps |
| Target in a mode | unsigned 8-bit, degrees Fahrenheit times two |
| Time of day | unsigned 16-bit, minute of the local day |

## Telemetry

Sent about once a second, and immediately after any command or physical
change so the app never shows a stale state. Payload is 42 bytes.

| Offset | Type | Field |
| --- | --- | --- |
| 0 | u32 | Uptime, seconds |
| 4 | u32 | Real time clock, epoch seconds |
| 8 | u16 | Flags, see below |
| 10 | u8 | Mode slot |
| 11 | u8 | Level in bits 0-1, effective level in bits 2-3 |
| 12 | u8 | Zones enabled in bits 0-2, zones energised now in bits 4-6 |
| 13 | u8 | Safety: two bits per zone, fault code in bits 6-7 |
| 14 | i16 | Collar skin temperature |
| 16 | i16 | Effective target |
| 18 | i16 x 3 | Panel temperature, zones L, R, B |
| 24 | u8 x 3 | Commanded duty, zones L, R, B |
| 27 | u8 | Left cell charge |
| 28 | u8 | Right cell charge |
| 29 | u8 | Cell flags: bit 0 left present, 1 left docked, 2 right present, 3 right docked |
| 30 | u16 | Left cell millivolts |
| 32 | u16 | Right cell millivolts |
| 34 | u16 | Pack draw, milliwatts |
| 36 | u16 | Runtime estimate, minutes. `0xFFFF` means none |
| 38 | u16 | Auto-off remaining, minutes. `0xFFFF` means none |
| 40 | i16 | Learned resting skin temperature |

Zone bit order is L = bit 0, R = bit 1, B = bit 2.

Flags:

| Bit | Meaning |
| --- | --- |
| 0 | Power: the wearer wants heat |
| 1 | Heating: at least one panel has a duty above zero |
| 2 | Wash lock |
| 3 | Eased to Low (Commute, still indoors) |
| 4 | Fading out |
| 5 | Firmware update in progress |
| 6 | Low battery |
| 7 | Schedule armed |
| 8 | Phone context: outdoors |
| 9 | Phone context: moving |
| 10 | Preheating |

Safety, two bits per zone: 0 ok, 1 cutoff, 2 lockout.
Fault code: 0 none, 1 panel over hard limit, 2 sensor.

The effective level differs from the level only while Commute has eased.

## Commands

The first payload byte is the opcode. The controller answers every command
with an Ack frame carrying the same sequence number.

| Opcode | Name | Payload after the opcode |
| --- | --- | --- |
| `0x01` | SetPower | u8 on |
| `0x02` | SetLevel | u8 level, 0 to 2 |
| `0x03` | SetMode | mode block (8 bytes), u8 start |
| `0x04` | SetZones | u8 zone mask |
| `0x05` | SetWashLock | u8 on |
| `0x06` | SetSchedule | u8 enabled, u16 minute of day, u8 day mask (bit 0 = Monday), u8 preheat minutes, u8 level, mode block |
| `0x07` | SyncTime | u32 epoch seconds, i16 minutes to add to UTC for local time |
| `0x08` | SetContext | u8 flags (bit 0 outdoors, bit 1 moving), i16 outside temperature |
| `0x09` | SafetyAck | u8 zone index, u8 action (0 dismiss, 1 lock out today, 2 clear lockout) |
| `0x0A` | SetName | u8 length, UTF-8 bytes, at most 24 |
| `0x0B` | SetPrefs | u8 flags (bit 0 auto-off when still, bit 1 button haptics) |
| `0x0C` | ClearFault | none |
| `0x0D` | SetSize | u8 size index, XS = 0 to XXL = 5 |
| `0x20` | OtaBegin | u32 image size, u32 image CRC-32, u8 major, u8 minor, u8 patch |
| `0x21` | OtaChunk | u32 offset, then up to 200 data bytes |
| `0x22` | OtaEnd | none |
| `0x23` | OtaAbort | none |

Mode block, 8 bytes:

| Offset | Type | Field |
| --- | --- | --- |
| 0 | u8 | Slot. 0 to 4 are the built-in modes, 16 and up are custom |
| 1 | u8 | Target, degrees Fahrenheit times two. 88 to 99 °F |
| 2 | u8 | Ramp: 0 slow, 1 normal, 2 fast |
| 3 | u8 | Zone mask this mode switches on |
| 4 | u8 | Flags: bit 0 pulse, 1 outdoor boost, 2 tracks outdoor, 3 ease indoors |
| 5 | u16 | Auto-off, minutes. 0 means never |
| 7 | u8 | Fade-out, minutes. 0 means none |

### Ack

Payload: u8 opcode, u8 code.

| Code | Name | Meaning |
| --- | --- | --- |
| 0 | Ok | Done |
| 1 | Invalid | Malformed, or a value out of range |
| 2 | Busy | Updating or restarting |
| 3 | Locked | Wash mode is on |
| 4 | LowBattery | Not enough charge |
| 5 | Fault | A safety fault is latched |
| 6 | Checksum | A firmware image failed its CRC |
| 7 | NoCells | No charged cell is seated |

SetPower(on) and SetMode with start are refused, in this order of priority,
with Locked, Fault, NoCells or LowBattery. SetMode still stores the mode when
it refuses to start it.

While an update is in flight every command except the Ota commands, SyncTime
and SetContext is answered with Busy.

## Events

Payload is 6 bytes: u8 code, u8 a, i16 b, i16 c.

| Code | Name | Arguments |
| --- | --- | --- |
| 1 | OverheatTrip | a = zone, b = peak temperature |
| 2 | OverheatClear | a = zone, b = temperature |
| 3 | ZoneLockout | a = zone |
| 4 | ZoneLockoutEnded | a = zone |
| 5 | LowBattery | a = percent |
| 6 | CriticalBattery | |
| 7 | CellRemoved | a = cell, 0 left, 1 right |
| 8 | CellInserted | a = cell |
| 9 | AutoOff | a = reason: 0 timer, 1 still, 2 fade |
| 10 | ScheduleStart | a = preheat minutes |
| 11 | Eased | a = 1 eased, 0 restored |
| 12 | OtaVerified | |
| 13 | OtaFailed | a = reason: 0 checksum, 1 size, 2 battery, 3 aborted |
| 14 | Rebooted | a = major, b = minor, c = patch |
| 15 | Fault | a = fault code |
| 16 | FaultCleared | |
| 17 | Button | a = 1 heating on, 0 heating off |

Events raised while no phone is connected are queued, up to 32, and delivered
on the next connection.

## Info

Read once after connecting and again after an update.

| Offset | Type | Field |
| --- | --- | --- |
| 0 | u8 x 3 | Firmware version: major, minor, patch |
| 3 | u8 | Hardware revision |
| 4 | u8 | Size index |
| 5 | 10 bytes | Serial number, ASCII, zero padded |
| 15 | u16 | Left cell cycles, tenths |
| 17 | u8 | Left cell health |
| 18 | u16 | Right cell cycles, tenths |
| 20 | u8 | Right cell health |
| 21 | u8 | Name length N |
| 22 | N | Name, UTF-8 |

## Firmware update

1. Phone sends **OtaBegin** with the image size and its CRC-32. The controller
   refuses with LowBattery unless one seated cell holds at least 30 %.
   Heating pauses. The heat controller's state is held, not cleared.
2. Phone sends **OtaChunk** frames in order. Each offset must equal the number
   of bytes received so far. An out-of-order chunk is answered with Invalid.
3. Phone sends **OtaEnd**. The controller compares its running CRC-32 with the
   one announced.
   - Mismatch: Ack Checksum, event OtaFailed, nothing changes.
   - Short image: Ack Invalid, event OtaFailed.
   - Match: Ack Ok, event OtaVerified, then a restart.
4. The link drops for about three seconds. The phone reconnects and reads
   Info to confirm the version. The Rebooted event is delivered on reconnect.

CRC-32 is the zlib polynomial, reflected, initial value and final XOR
`0xFFFFFFFF`. The check value for ASCII `123456789` is `0xCBF43926`.

Image header, 16 bytes: magic `WUFW`, version (3 bytes), header length,
u32 body length, u32 CRC-32 of the body.

## Behaviour the app relies on

- The controller reports a telemetry frame straight after any change.
- The controller keeps the preheat schedule and runs it by its own clock.
- The safety cutoff cannot be overridden by any command. SafetyAck can only
  lock a zone out or lift a lockout, never lift a cutoff.
- Wash lock ignores the hem button.
- Still-ness auto-off applies only to modes with no timer of their own.
