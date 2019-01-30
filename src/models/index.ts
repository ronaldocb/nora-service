import { LightDevice, LightDeviceWithBrightness, LightDeviceWithColor } from './light';
import { OutletDevice } from './outlet';
import { SceneDevice } from './scene';
import { SwitchDevice } from './switch';
import { ThermostatDevice } from './thermostat';

export interface Devices {
    [id: string]: Device;
}

export type Device = SwitchDevice | LightDevice | LightDeviceWithBrightness |
    LightDeviceWithColor | SceneDevice | OutletDevice | ThermostatDevice;

export type AllStates = Device['state'];

export interface StateChanges {
    [deviceId: string]: Partial<AllStates>;
}