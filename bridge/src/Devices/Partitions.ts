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
  buildPartitionCommandFromStrategy,
  DEFAULT_PARTITION_COMMAND_STRATEGY,
  PartitionCommandVerb,
  PartitionCommandStrategy,
} from '../PartitionCommandConfig'

export interface PartitionCommandAttempt {
  strategy: PartitionCommandStrategy
  rawCommand: string
}

export interface PartitionDebugStateSnapshot {
  arm: boolean
  homeStay: boolean
  ready: boolean
  open: boolean
  alarm: boolean
}

export interface PartitionCommandExecutionAttempt extends PartitionCommandAttempt {
  response?: string
  ack: boolean
  stateConfirmed: boolean
  success: boolean
  errorCode?: string
  errorMessage?: string
  timeout?: boolean
}

export interface PartitionCommandExecutionResult {
  partitionId: number
  command: PartitionCommandVerb
  success: boolean
  attempts: PartitionCommandExecutionAttempt[]
  finalState: PartitionDebugStateSnapshot
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

  private getStateSnapshot(): PartitionDebugStateSnapshot {
    return {
      arm: this.Arm,
      homeStay: this.HomeStay,
      ready: this.Ready,
      open: this.Open,
      alarm: this.Alarm,
    }
  }

  private getPartitionCommandAttempts(command: PartitionCommandVerb): PartitionCommandAttempt[] {
    const config = this.riscoComm.getPartitionCommandConfig()
    const strategies = (this.Id >= 10 && config.mode === 'probe')
      ? config.probeOrder
      : [config.strategy || DEFAULT_PARTITION_COMMAND_STRATEGY]

    const uniqueStrategies = [...new Set(strategies)]
    return uniqueStrategies.map(strategy => ({
      strategy,
      rawCommand: buildPartitionCommandFromStrategy(command, this.Id, strategy),
    }))
  }

  previewPartitionCommandAttempts(
    command: PartitionCommandVerb,
    strategies?: PartitionCommandStrategy[],
  ): PartitionCommandAttempt[] {
    const selectedStrategies = (strategies && strategies.length > 0)
      ? [...new Set(strategies)]
      : [...new Set(this.getPartitionCommandAttempts(command).map(attempt => attempt.strategy))]

    return selectedStrategies.map(strategy => ({
      strategy,
      rawCommand: buildPartitionCommandFromStrategy(command, this.Id, strategy),
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

  private expectedStateFor(command: PartitionCommandVerb): (() => boolean) | null {
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

  private async waitForExpectedState(command: PartitionCommandVerb, timeoutMs = 4000, intervalMs = 400): Promise<boolean> {
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

  private async executePartitionCommandAttempts(
    command: PartitionCommandVerb,
    attempts: PartitionCommandAttempt[],
  ): Promise<PartitionCommandExecutionResult> {
    assertIsDefined(this.riscoComm.tcpSocket, 'RiscoComm.tcpSocket', 'TCP is not initialized')
    const tcpSocket = this.riscoComm.tcpSocket
    const attemptResults: PartitionCommandExecutionAttempt[] = []

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
          attemptResults.push({
            ...attempt,
            response,
            ack: true,
            stateConfirmed: ok,
            success: ok,
          })
          if (ok) {
            logger.log('info', `Partition ${this.Id} ${command} succeeded with strategy '${attempt.strategy}'`)
            return {
              partitionId: this.Id,
              command,
              success: true,
              attempts: attemptResults,
              finalState: this.getStateSnapshot(),
            }
          }
          if (!isLast) {
            logger.log('warn', `Command ${command} ACK for partition ${this.Id} with strategy '${attempt.strategy}', but target partition state did not change. Trying next strategy.`)
            continue
          }
          logger.log('warn', `Partition ${this.Id} ${command} got ACK with strategy '${attempt.strategy}', but target state was not confirmed.`)
          return {
            partitionId: this.Id,
            command,
            success: false,
            attempts: attemptResults,
            finalState: this.getStateSnapshot(),
          }
        }
        const error = tcpSocket.getErrorCode(response)
        attemptResults.push({
          ...attempt,
          response,
          ack: false,
          stateConfirmed: false,
          success: false,
          errorCode: error?.[0],
          errorMessage: error?.[1],
        })
        if (!isLast && error?.[0] === 'N05') {
          logger.log('warn', `Command ${command} rejected for partition ${this.Id} with strategy '${attempt.strategy}' (N05). Trying next strategy.`)
          continue
        }
        logger.log('warn', `Partition ${this.Id} ${command} rejected with strategy '${attempt.strategy}' response='${response}'`)
        return {
          partitionId: this.Id,
          command,
          success: false,
          attempts: attemptResults,
          finalState: this.getStateSnapshot(),
        }
      } catch (err) {
        if (err instanceof RiscoCommandError) {
          const ok = await this.waitForExpectedState(command)
          attemptResults.push({
            ...attempt,
            ack: false,
            stateConfirmed: ok,
            success: ok,
            timeout: true,
            errorMessage: err.message,
          })
          if (ok) {
            logger.log('info', `Partition ${this.Id} ${command} succeeded after timeout using strategy '${attempt.strategy}'`)
            return {
              partitionId: this.Id,
              command,
              success: true,
              attempts: attemptResults,
              finalState: this.getStateSnapshot(),
            }
          }
          if (!isLast) {
            logger.log('warn', `Command ${command} timeout for partition ${this.Id} with strategy '${attempt.strategy}'. Trying next strategy.`)
            continue
          }
        }
        if (!(err instanceof RiscoCommandError)) {
          attemptResults.push({
            ...attempt,
            ack: false,
            stateConfirmed: false,
            success: false,
            errorMessage: err instanceof Error ? err.message : String(err),
          })
        }
        throw err
      }
    }

    return {
      partitionId: this.Id,
      command,
      success: false,
      attempts: attemptResults,
      finalState: this.getStateSnapshot(),
    }
  }

  async debugPartitionCommand(
    command: PartitionCommandVerb,
    strategies?: PartitionCommandStrategy[],
  ): Promise<PartitionCommandExecutionResult> {
    const attempts = (strategies && strategies.length > 0)
      ? this.previewPartitionCommandAttempts(command, strategies)
      : this.getPartitionCommandAttempts(command)
    return this.executePartitionCommandAttempts(command, attempts)
  }

  async debugRawPartitionCommand(
    command: PartitionCommandVerb,
    rawCommand: string,
    strategy: PartitionCommandStrategy = DEFAULT_PARTITION_COMMAND_STRATEGY,
  ): Promise<PartitionCommandExecutionResult> {
    return this.executePartitionCommandAttempts(command, [{
      strategy,
      rawCommand,
    }])
  }

  private async sendPartitionCommand(command: PartitionCommandVerb): Promise<boolean> {
    const result = await this.debugPartitionCommand(command)
    return result.success
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
