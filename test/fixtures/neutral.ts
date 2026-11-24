/**
 * Synthetic neutral-text fixtures (outline section 7, N1 to N12). Generic tag names only.
 */

const longRung =
	Array.from({ length: 40 }, (_, i) => `XIC(Station_01_Sensor_${String(i + 1).padStart(2, "0")})`).join("") +
	"OTE(Station_01_All_Sensors_OK);";

export const NEUTRAL = {
	N01_single: "XIC(Start)OTE(Run);",
	N02_seal_in: "[XIC(Start_PB),XIC(Motor_Run)]XIO(Stop_PB)OTE(Motor_Run);",
	N03_nested: "XIC(A)[XIC(B)[XIC(C)[XIC(D),XIO(E)],XIO(F)],XIC(G)]OTE(H);",
	N04_output_branch: "XIC(Run)[OTE(Lamp_01),OTL(Latch_01),TON(Delay_01,5000,0)];",
	N05_empty_leg: "XIC(Auto)[XIC(Cmd),]OTE(Out);",
	N06_box_in_leg: "XIC(Enable)[TON(T1,1000,0),XIC(T1.DN)MOV(5,Step)]OTE(Done);",
	N07_operands:
		"XIC(Arr[3,1].5)XIC(Udt.Member.Sub)XIC(Tbl[Idx].Bit)XIC(Program:MainProgram.Local_Tag)OTE(Out[2]);",
	N08_expressions: "CMP(ABS(A-B)>(C*2))CPT(Out,ABS(A-B)*2+MOD(C,4))OTE(Flag);",
	N09_aoi: "XIC(Enable)Valve_AOI(Valve_01,Open_Cmd,Close_Cmd,?,?)OTE(Ready);",
	N10_qmarks: "XIC(?)TON(Timer_01,?,?)OTE(?);",
	N11_long: longRung,
	N12_malformed: [
		"XIC(A)OTE(B);",
		"[XIC(C),XIC(D)OTE(E);",
		"XIC(F)]OTE(G);",
		"XIC(H OTE(I);",
		"XIC(J)OTE(K);",
		"XIC(L)OTE(M)",
	].join("\n"),
} as const;

export type NeutralFixture = keyof typeof NEUTRAL;
