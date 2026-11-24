# Ladder samples

Dev vault note for eyeballing the plugin. All tags are synthetic.

## Neutral text: seal-in

```ladder
// Motor seal-in
[XIC(Start_PB),XIC(Motor_Run)]XIO(Stop_PB)OTE(Motor_Run);
// Run-on delay
XIC(Motor_Run)TON(Motor_Delay,5000,0);
```

## Neutral text: nested branches, boxes, v36 mnemonics

```ladder
---
start: 10
---
XIC(Auto)[XIC(Cmd_Start),XIC(Pump_01.Running)[XIO(Fault),]]XIO(Estop)[OTE(Pump_01.Cmd),TON(Pump_01_Dly,?,?)];
GE(Tank_01.Level,80.0)LIMIT(10,Tank_01.Temp,90)MOVE(0,Valve_02.Pos);
```

## Neutral text: outputs against the right rail

Same seal-in as above with `align: right`; the default (`inline`) keeps outputs right after the last input.

```ladder
---
align: right
---
[XIC(Start_PB),XIC(Motor_Run)]XIO(Stop_PB)OTE(Motor_Run);
XIC(Motor_Run)TON(Motor_Delay,5000,0);
```

## L5K routine text

```ladder
RC: "Pump permissive$N"
    "Second comment line";
N: XIC(Permissive_01)XIO(Fault_01)OTE(Pump_01.Permit);
N: XIC(Pump_01.Permit)ONS(Pump_01_Ons)OTL(Pump_01.Latched);
```

## L5X rung snippet

```ladder
<Rung Number="4" Type="N">
<Comment>
<![CDATA[Valve open command]]>
</Comment>
<Text>
<![CDATA[XIC(Valve_01.Open_Req)XIO(Valve_01.Fault)OTE(Valve_01.Open_Cmd);]]>
</Text>
</Rung>
```

## PLCopen XML (CODESYS style)

```ladder
<LD>
<leftPowerRail localId="1"><position x="0" y="0" /><connectionPointOut formalParameter="none" /></leftPowerRail>
<contact localId="2" negated="false" storage="none" edge="none"><position x="100" y="0" /><connectionPointIn><connection refLocalId="1" /></connectionPointIn><connectionPointOut /><variable>stIn.xReady</variable></contact>
<contact localId="3" negated="true" storage="none" edge="none"><position x="200" y="0" /><connectionPointIn><connection refLocalId="2" /></connectionPointIn><connectionPointOut /><variable>stIn.xFault</variable></contact>
<coil localId="4" negated="false" storage="none"><position x="300" y="0" /><connectionPointIn><connection refLocalId="3" /></connectionPointIn><connectionPointOut /><variable>astSeq[10].xOkToStep</variable></coil>
<rightPowerRail localId="5"><position x="400" y="0" /><connectionPointIn><connection refLocalId="4" /></connectionPointIn></rightPowerRail>
</LD>
```

## Header error (should show an error panel)

```ladder
---
colour: red
---
XIC(A)OTE(B);
```
