/* 
 *  Package: risco-lan-bridge
 *  File: Partitions.js
 *  
 *  MIT License
 *  
 *  Copyright (c) 2021 TJForc
 *  
 *  Permission is hereby granted, free of charge, to any person obtaining a copy
 *  of this software and associated documentation files (the "Software"), to deal
 *  in the Software without restriction, including without limitation the rights
 *  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 *  copies of the Software, and to permit persons to whom the Software is
 *  furnished to do so, subject to the following conditions:
 *  
 *  The above copyright notice and this permission notice shall be included in all
 *  copies or substantial portions of the Software.
 *  
 *  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 *  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 *  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 *  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 *  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 *  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 *  SOFTWARE.
 */

'use strict'

import { RiscoComm } from '../RiscoComm'
import { EventEmitter } from 'events'
import { logger } from '../Logger'
import { assertIsDefined } from '../Assertions'
import { RiscoCommandError } from '../RiscoError'
import {
  DEFAULT_PARTITION_COMMAND_STRATEGY,
  PartitionCommandStrategy,
} from '../PartitionCommandConfig'

interface PartitionCommandAttempt {
  strategy: PartitionCommandStrategy
  rawCommand: string
}

export class Partition extends EventEmitter {
  Id: number
  riscoComm: RiscoComm
  Label: string
  PStatus: string
  FirstStatus: boolean
  NeedUpdateConfig: boolean

  // a
  Alarm = false
  // D
  Duress = false
  // C
  FalseCode = false
  // F
  Fire = false
  // P
  Panic = false
  // M
  Medic = false
  // N
  NoActivity = false
  // A
  Arm = false
  // H
  HomeStay = false
  // R
  // Ready: In the sense that the partition is capable of being armed
  Ready = false
  // O
  // true if at least 1 zone of the partition is active
  // false if all the zones of the partition are inactive
  Open = false
  // E
  Exist = false
  // S
  ResetRequired = false
  // 1
  GrpAArm = false
  // 2
  GrpBArm = false
  // 3
  GrpCArm = false
  // 4
  GrpDArm = false
  // T
  Trouble = false

  constructor(Id: number, riscoComm: RiscoComm, Label?: string, PStatus?: string) {
    super()
    this.Id = Id || 1
    this.riscoComm = riscoComm
    this.Label = Label || ''
    this.PStatus = PStatus || '-----------------'
    this.FirstStatus = true
    this.NeedUpdateConfig = false

    if (this.PStatus !== '-----------------') {
      this.Status = this.PStatus
    }
  }

  set Status(value: string) {
    if (value !== undefined) {
      const stateArray = [
        ['a', 'this.Alarm', 'Alarm', 'StandBy'],
        ['D', 'this.Duress', 'Duress', 'Free'],
        ['C', 'this.FalseCode', 'FalseCode', 'CodeOk'],
        ['F', 'this.Fire', 'Fire', 'NoFire'],
        ['P', 'this.Panic', 'Panic', 'NoPanic'],
        ['M', 'this.Medic', 'Medic', 'NoMedic'],
        ['A', 'this.Arm', 'Armed', 'Disarmed'],
        ['H', 'this.HomeStay', 'HomeStay', 'HomeDisarmed'],
        ['R', 'this.Ready', 'Ready', 'NotReady'],
        ['O', 'this.Open', 'ZoneOpen', 'ZoneClosed'],
        ['E', 'this.Exist', 'Exist', 'NotExist'],
        ['S', 'this.ResetRequired', 'MemoryEvent', 'MemoryAck'],
        ['N', 'this.NoActivity', 'ActivityAlert', 'ActivityOk'],
        ['1', 'this.GrpAArm', 'GrpAArmed', 'GrpADisarmed'],
        ['2', 'this.GrpBArm', 'GrpBArmed', 'GrpBDisarmed'],
        ['3', 'this.GrpCArm', 'GrpCArmed', 'GrpCDisarmed'],
        ['4', 'this.GrpDArm', 'GrpDArmed', 'GrpDDisarmed'],
        ['T', 'this.Trouble', 'Trouble', 'Ok']
      ]
      stateArray.forEach(StateValue => {
        const previousStateValue = eval(StateValue[1])
        if (value.includes(StateValue[0])) {
          eval(`${StateValue[1]} = true;`)
          if (!previousStateValue) {
            if (!this.FirstStatus) {
              this.emit(`PStatusChanged`, this.Id, StateValue[2])
              this.emit(StateValue[2], this.Id)
            }
          }
        } else {
          eval(`${StateValue[1]} = false;`)
          if (previousStateValue) {
            if (!this.FirstStatus) {
              this.emit(`PStatusChanged`, this.Id, StateValue[3])
              this.emit(StateValue[3], this.Id)
            }
          }
        }
      })
      this.FirstStatus = false
    }
  }

  private buildPartitionCommand(command: string, strategy: PartitionCommandStrategy): string {
    const decimal = `${this.Id}`
    const decimalPadded2 = decimal.padStart(2, '0')
    const decimalPadded3 = decimal.padStart(3, '0')
    const hex = this.Id.toString(16).toUpperCase()
    const hexPadded2 = hex.padStart(2, '0')

    switch (strategy) {
      case 'equals_star_decimal':
        return `${command}=*${decimal}`
      case 'colon_decimal':
        return `${command}:${decimal}`
      case 'colon_zero_pad_3':
        return `${command}:${decimalPadded3}`
      case 'equals_zero_pad_3':
        return `${command}=${decimalPadded3}`
      case 'equals_hex':
        return `${command}=${hex}`
      case 'equals_hex_zero_pad_2':
        return `${command}=${hexPadded2}`
      case 'equals_plain':
      default:
        return `${command}=${decimal}`
    }
  }

  private getPartitionCommandAttempts(command: string): PartitionCommandAttempt[] {
    const config = this.riscoComm.getPartitionCommandConfig()
    const strategies = (this.Id >= 10 && config.mode === 'probe')
      ? config.probeOrder
      : [config.strategy || DEFAULT_PARTITION_COMMAND_STRATEGY]

    const uniqueStrategies = [...new Set(strategies)]
    return uniqueStrategies.map(strategy => ({
      strategy,
      rawCommand: this.buildPartitionCommand(command, strategy),
    }))
  }

  private async refreshStatus(): Promise<void> {
    assertIsDefined(this.riscoComm.tcpSocket, 'RiscoComm.tcpSocket', 'TCP is not initialized')
    try {
      const status = await this.riscoComm.tcpSocket.getResult(`PSTT${this.Id}?`)
      this.Status = status
    } catch (err) {
      logger.log('warn', `Failed to refresh partition ${this.Id} status: ${err}`)
    }
  }

  private expectedStateFor(command: string): (() => boolean) | null {
    switch (command) {
      case 'ARM':
        return () => this.Arm && !this.HomeStay
      case 'STAY':
        return () => this.HomeStay
      case 'DISARM':
        return () => !this.Arm && !this.HomeStay
      default:
        return null
    }
  }

  private async waitForExpectedState(command: string, timeoutMs = 4000, intervalMs = 400): Promise<boolean> {
    const expected = this.expectedStateFor(command)
    if (!expected) return true

    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      await this.refreshStatus()
      if (expected()) return true
      await new Promise(resolve => setTimeout(resolve, intervalMs))
    }
    return expected()
  }

  private async sendPartitionCommand(command: string): Promise<boolean> {
    assertIsDefined(this.riscoComm.tcpSocket, 'RiscoComm.tcpSocket', 'TCP is not initialized')
    const tcpSocket = this.riscoComm.tcpSocket
    const attempts = this.getPartitionCommandAttempts(command)

    for (let i = 0; i < attempts.length; i++) {
      const attempt = attempts[i]
      const isLast = i === attempts.length - 1
      try {
        logger.log(
          'info',
          `Partition ${this.Id} trying ${command} with strategy '${attempt.strategy}' (${i + 1}/${attempts.length}): ${attempt.rawCommand}`,
        )
        const response = await tcpSocket.sendCommand(attempt.rawCommand)
        if (response === 'ACK') {
          const ok = await this.waitForExpectedState(command)
          if (ok) return true
          if (!isLast) {
            logger.log('warn', `Command ${command} ACK for partition ${this.Id} with strategy '${attempt.strategy}', but target partition state did not change. Trying next strategy.`)
            continue
          }
          return false
        }
        const error = tcpSocket.getErrorCode(response)
        if (!isLast && error?.[0] === 'N05') {
          logger.log('warn', `Command ${command} rejected for partition ${this.Id} with strategy '${attempt.strategy}' (N05). Trying next strategy.`)
          continue
        }
        return false
      } catch (err) {
        if (err instanceof RiscoCommandError) {
          const ok = await this.waitForExpectedState(command)
          if (ok) return true
          if (!isLast) {
            logger.log('warn', `Command ${command} timeout for partition ${this.Id} with strategy '${attempt.strategy}'. Trying next strategy.`)
            continue
          }
        }
        throw err
      }
    }
    return false
  }

  async awayArm(): Promise<boolean> {
    assertIsDefined(this.riscoComm.tcpSocket, 'RiscoComm.tcpSocket', 'TCP is not initialized')
    logger.log('debug', `Request for Full Arming partition ${this.Id}.`)
    if (!this.Ready || this.Open) {
      logger.log('warn', `Failed to Full Arming partition ${this.Id} : partition is not ready or is open`)
      return false
    }
    if (this.Arm && !this.HomeStay) {
      logger.log('debug', `No need to arm away partition ${this.Id} : partition already armed away`)

      return true
    } else {
      return await this.sendPartitionCommand('ARM')
    }
  }

  async homeStayArm(): Promise<boolean> {
    assertIsDefined(this.riscoComm.tcpSocket, 'RiscoComm.tcpSocket', 'TCP is not initialized')
    logger.log('debug', `Request for Stay Arming partition ${this.Id}.`)
    if (!this.Ready || this.Open) {
      logger.log('warn', `Failed to Stay Arming partition ${this.Id} : partition is not ready or is open`)
      return false
    }
    if (this.HomeStay) {
      logger.log('debug', `No need to arm home partition ${this.Id} : partition already armed home`)
      return true
    } else {
      return await this.sendPartitionCommand('STAY')
    }
  }

  async disarm(): Promise<boolean> {
    assertIsDefined(this.riscoComm.tcpSocket, 'RiscoComm.tcpSocket', 'TCP is not initialized')
    logger.log('debug', `Request for Disarming partition ${this.Id}.`)
    if (!this.Arm && !this.HomeStay) {
      logger.log('debug', `No need to disarm partition ${this.Id} : partition is not armed`)
      return true
    } else {
      return await this.sendPartitionCommand('DISARM')
    }
  }
}

export class PartitionList extends EventEmitter {

  readonly values: Partition[]

  constructor(len: number, RiscoComm: RiscoComm) {
    super()
    this.values = new Array(len)

    for (let i = 0; i < len; i++) {
      this.values[i] = new Partition(i + 1, RiscoComm)
    }

    this.values.forEach(partition => {
      partition.on('PStatusChanged', (Id, EventStr) => {
        this.emit('PStatusChanged', Id, EventStr)
      })
    })
  }

  byId(Id: number): Partition {
    if ((Id > this.values.length) || (Id < 0)) {
      logger.log('warn', `Invalid Partition id ${Id}`)
    }
    return this.values[Id - 1]
  }
}
