// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
const save = vi.fn();const close = vi.fn();
vi.mock("../../context/AppContext",()=>({useApp:()=>({user:{rate:30},selectedJob:{name:"Retail job"},shifts:[{id:"shift",date:"2026-11-20",location:"Jesmond",signIn:"09:00",signOut:"13:00",appliedRate:30}],updateShiftOrThrow:save})}));
const {ShiftRateDialog}=await import("../ShiftRateDialog");
afterEach(()=>{cleanup();vi.resetAllMocks();});
describe("current-week recorded pay review",()=>{
  it("previews the correction and saves only that shift through the reviewed action",async()=>{
    save.mockResolvedValue({});const user=userEvent.setup();render(<ShiftRateDialog shiftId="shift" onClose={close}/>);
    const input=screen.getByLabelText("Recorded hourly rate (AUD)");await user.clear(input);await user.type(input,"34");
    expect(screen.getByText(/4.00h · \$120.00 → \$136.00 wages/)).toBeTruthy();
    await user.click(screen.getByRole("button",{name:"Review & save correction"}));
    expect(save).toHaveBeenCalledWith("shift",{rateOverride:34});expect(close).toHaveBeenCalledTimes(1);
  });
  it("keeps the draft open when review is cancelled or the save fails",async()=>{
    save.mockRejectedValue(new Error("Rate change cancelled."));const user=userEvent.setup();render(<ShiftRateDialog shiftId="shift" onClose={close}/>);
    const input=screen.getByLabelText("Recorded hourly rate (AUD)");await user.clear(input);await user.type(input,"35");await user.click(screen.getByRole("button",{name:"Review & save correction"}));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent","Rate change cancelled.");expect(close).not.toHaveBeenCalled();expect((input as HTMLInputElement).value).toBe("35");
  });
});
