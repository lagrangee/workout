import { mount } from "@vue/test-utils";
import { expect, test } from "vitest";
import SessionSyncStatus from "./SessionSyncStatus.vue";

test("pending and saved distinguish local persistence from server acknowledgement", async () => {
  const wrapper = mount(SessionSyncStatus, { props: { status: "pending" } });
  expect(wrapper.get("summary").text()).toBe("已存本机");
  expect(wrapper.text()).toContain("正在同步");
  expect(wrapper.find("[data-action='retry-sync']").exists()).toBe(false);
  await wrapper.setProps({ status: "saved" });
  expect(wrapper.get("summary").text()).toBe("已同步");
  expect(wrapper.text()).toContain("云端确认");
  wrapper.unmount();
});

test.each(["error", "conflict"] as const)("%s retains explicit retry and discard actions", async (status) => {
  const wrapper = mount(SessionSyncStatus, { props: { status } });
  if (status === "conflict") expect(wrapper.get("details").attributes("open")).toBeDefined();
  await wrapper.get("[data-action='retry-sync']").trigger("click");
  expect(wrapper.emitted("retry")).toHaveLength(1);
  expect(wrapper.emitted("discard")).toBeUndefined();
  await wrapper.get("[data-action='discard-sync']").trigger("click");
  expect(wrapper.emitted("discard")).toHaveLength(1);
  wrapper.unmount();
});


test("compact header status retains its accessible label and recovery controls", async () => {
  const wrapper = mount(SessionSyncStatus, { props: { status: "error", compact: true } });
  expect(wrapper.get("summary").attributes("aria-label")).toContain("训练保存状态：待同步");
  expect(wrapper.get("summary span").classes()).toContain("sync-label-hidden");
  expect(wrapper.classes()).toContain("is-compact");
  await wrapper.get("[data-action='retry-sync']").trigger("click");
  expect(wrapper.emitted("retry")).toHaveLength(1);
  wrapper.unmount();
});
