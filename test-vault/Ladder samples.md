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
<contact localId="2" negated="false" storage="none" edge="none"><position x="100" y="0" /><connectionPointIn><connection refLocalId="1" /></connectionPointIn><connectionPointOut /><variable>stInputs.xReady</variable></contact>
<contact localId="3" negated="true" storage="none" edge="none"><position x="200" y="0" /><connectionPointIn><connection refLocalId="2" /></connectionPointIn><connectionPointOut /><variable>stInputs.xFault</variable></contact>
<coil localId="4" negated="false" storage="none"><position x="300" y="0" /><connectionPointIn><connection refLocalId="3" /></connectionPointIn><connectionPointOut /><variable>aSteps[10].xDone</variable></coil>
<rightPowerRail localId="5"><position x="400" y="0" /><connectionPointIn><connection refLocalId="4" /></connectionPointIn></rightPowerRail>
</LD>
```

## PLCopen XML (CODESYS networks with function blocks)

R_TRIG into CTU, with RESET fed by its own contact. Networks are numbered from 1; coils sit at the right rail.

```ladder
<LD>
<leftPowerRail localId="0"><position x="0" y="0" /><connectionPointOut formalParameter="none" /></leftPowerRail>
<comment localId="1" height="0" width="0"><position x="0" y="0" /><content><xhtml xmlns="http://www.w3.org/1999/xhtml">Count parts, reset by operator</xhtml></content></comment>
<vendorElement localId="2"><position x="0" y="0" /><alternativeText><xhtml xmlns="http://www.w3.org/1999/xhtml" /></alternativeText><addData><data name="http://www.3s-software.com/plcopenxml/fbdelementtype" handleUnknown="implementation"><ElementType xmlns="">networktitle</ElementType></data></addData></vendorElement>
<contact localId="3"><position x="0" y="0" /><connectionPointIn><connection refLocalId="0" /></connectionPointIn><connectionPointOut /><variable>xPartSensor</variable></contact>
<block localId="4" typeName="R_TRIG" instanceName="rtPart"><position x="0" y="0" /><inputVariables><variable formalParameter="CLK"><connectionPointIn><connection refLocalId="3" /></connectionPointIn></variable></inputVariables><inOutVariables /><outputVariables><variable formalParameter="Q"><connectionPointOut /></variable></outputVariables></block>
<contact localId="5"><position x="0" y="0" /><connectionPointIn><connection refLocalId="0" /></connectionPointIn><connectionPointOut /><variable>xResetCount</variable></contact>
<inVariable localId="6"><position x="0" y="0" /><connectionPointOut /><expression>100</expression></inVariable>
<block localId="7" typeName="CTU" instanceName="ctuParts"><position x="0" y="0" /><inputVariables><variable formalParameter="CU"><connectionPointIn><connection refLocalId="4" formalParameter="Q" /></connectionPointIn></variable><variable formalParameter="RESET"><connectionPointIn><connection refLocalId="5" /></connectionPointIn></variable><variable formalParameter="PV"><connectionPointIn><connection refLocalId="6" /></connectionPointIn></variable></inputVariables><inOutVariables /><outputVariables><variable formalParameter="Q"><connectionPointOut /></variable><variable formalParameter="CV"><connectionPointOut><expression>iCount</expression></connectionPointOut></variable></outputVariables></block>
<coil localId="8"><position x="0" y="0" /><connectionPointIn><connection refLocalId="7" formalParameter="Q" /></connectionPointIn><connectionPointOut /><variable>xBatchDone</variable></coil>
<rightPowerRail localId="2147483646"><position x="0" y="0" /><connectionPointIn /></rightPowerRail>
</LD>
```

## Header error (should show an error panel)

```ladder
---
colour: red
---
XIC(A)OTE(B);
```
