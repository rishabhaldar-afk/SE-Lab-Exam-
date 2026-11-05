import { countDiagramCells } from "../core/report.js";
import { el } from "./dom.js";

const EMPTY_XML = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>';
const CLASS_STYLE = "swimlane;fontStyle=1;align=center;verticalAlign=top;childLayout=stackLayout;horizontal=1;startSize=26;horizontalStack=0;resizeParent=1;resizeParentMax=0;resizeLast=0;collapsible=1;marginBottom=0;whiteSpace=wrap;html=1;";
const FIELD_STYLE = "text;strokeColor=none;fillColor=none;align=left;verticalAlign=top;spacingLeft=4;spacingRight=4;overflow=hidden;rotatable=0;points=[[0,0.5],[1,0.5]];portConstraint=eastwest;whiteSpace=wrap;html=1;";
const DIVIDER_STYLE = "line;strokeWidth=1;fillColor=none;align=left;verticalAlign=middle;spacingTop=-1;spacingLeft=3;spacingRight=3;rotatable=0;labelPosition=right;points=[];portConstraint=eastwest;strokeColor=inherit;";

function graphXml(cells) {
  return `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel>`;
}

function vertexXml(id, value, style, w, h, parent = "1", y = 0) {
  const yAttr = y ? ` y="${y}"` : "";
  return `<mxCell id="${id}" value="${value}" style="${style}" vertex="1" parent="${parent}"><mxGeometry${yAttr} width="${w}" height="${h}" as="geometry"/></mxCell>`;
}

function shape(title, style, w, h, label = title) {
  return { title, w, h, xml: graphXml(vertexXml("2", label, style, w, h)) };
}

function classShape(title, header) {
  return {
    title,
    w: 160,
    h: 86,
    xml: graphXml(
      vertexXml("2", header, CLASS_STYLE, 160, 86)
      + vertexXml("3", "+ field: type", FIELD_STYLE, 160, 26, "2", 26)
      + vertexXml("4", "", DIVIDER_STYLE, 160, 8, "2", 52)
      + vertexXml("5", "+ method(): type", FIELD_STYLE, 160, 26, "2", 60),
    ),
  };
}

// The built-in UML palette is created collapsed, under the open General list,
// so class and state shapes sit below the visible sidebar until that header is opened.
const EXAM_UML = {
  title: { main: "UML" },
  entries: [{
    id: "exam-uml",
    title: { main: "UML" },
    desc: { main: "Class, state, use case, sequence, and activity shapes" },
    libs: [{
      title: { main: "UML" },
      expand: true,
      data: [
        classShape("Class", "ClassName"),
        classShape("Interface", "«interface»"),
        shape("Actor", "shape=umlActor;verticalLabelPosition=bottom;verticalAlign=top;html=1;outlineConnect=0;", 30, 60, "Actor"),
        shape("Use Case", "ellipse;whiteSpace=wrap;html=1;", 140, 70),
        shape("Package", "shape=folder;fontStyle=1;spacingTop=10;tabWidth=40;tabHeight=14;tabPosition=left;html=1;whiteSpace=wrap;", 140, 80),
        shape("Component", "shape=component;align=left;spacingLeft=36;whiteSpace=wrap;html=1;", 120, 60),
        shape("Lifeline", "shape=umlLifeline;perimeter=lifelinePerimeter;whiteSpace=wrap;html=1;container=1;dropTarget=0;collapsible=0;recursiveResize=0;outlineConnect=0;portConstraint=eastwest;", 100, 160, ":Object"),
        shape("State", "rounded=1;whiteSpace=wrap;html=1;arcSize=24;", 120, 60),
        shape("Start", "ellipse;html=1;shape=startState;fillColor=#000000;strokeColor=#ff0000;", 30, 30, ""),
        shape("End", "ellipse;html=1;shape=endState;fillColor=#000000;strokeColor=#ff0000;", 30, 30, ""),
        shape("Choice", "rhombus;whiteSpace=wrap;html=1;", 80, 80),
        shape("Action", "rounded=1;whiteSpace=wrap;html=1;arcSize=20;", 120, 40),
        shape("Note", "shape=note;whiteSpace=wrap;html=1;backgroundOutline=1;size=15;fillColor=#fff2cc;strokeColor=#d6b656;", 100, 60),
        shape("Frame", "shape=umlFrame;whiteSpace=wrap;html=1;pointerEvents=0;", 160, 90),
      ],
    }],
  }],
};

export function drawioUrl(origin) {
  const base = String(origin).replace(/\/$/, "");
  return `${base}/?embed=1&proto=json&spin=1&configure=1&libraries=1&noSaveBtn=1&noExitBtn=1&saveAndExit=0`;
}

function parseMessage(data) {
  if (typeof data === "string") {
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  }
  return data && typeof data === "object" ? data : null;
}

export function mountUml(parent, opts) {
  let xmls = [opts.xmls?.[0] || "", opts.xmls?.[1] || ""];
  let active = 0;
  const frames = [null, null];
  const slots = [
    { ready: false, timer: 0, exportWait: null, failed: false },
    { ready: false, timer: 0, exportWait: null, failed: false },
  ];

  const tabBar = el("div", { class: "subtabs", role: "tablist" });
  const stage = el("div", { class: "diagram-stage" });
  const loading = el("div", { class: "stage-loading" }, [
    el("div", { class: "spinner", "aria-hidden": "true" }),
    el("p", {}, ["Loading the diagram editor…"]),
  ]);
  const errorPanel = el("div", { class: "editor-error" });
  errorPanel.hidden = true;
  stage.append(loading, errorPanel);
  parent.append(el("div", { class: "uml-head" }, [
    tabBar,
    el("p", { class: "part-a" }, ["Draw the two diagrams named in Part A of your question paper, one in each tab."]),
  ]), stage);

  const badges = [];
  const tabs = [0, 1].map((index) => {
    const badge = el("span", { class: "badge" }, ["Loading"]);
    const button = el("button", { type: "button", role: "tab", class: "subtab" }, [`Diagram ${index + 1}`, badge]);
    button.addEventListener("click", () => select(index));
    tabBar.append(button);
    badges.push(badge);
    return button;
  });

  // Tells the student at a glance which diagram still needs work.
  function paintBadge(index) {
    const badge = badges[index];
    if (!slots[index].ready) {
      badge.textContent = slots[index].failed ? "Not loaded" : "Loading";
      badge.className = slots[index].failed ? "badge is-bad" : "badge";
      return;
    }
    const cells = countDiagramCells(xmls[index]);
    badge.textContent = cells ? `${cells} ${cells === 1 ? "shape" : "shapes"}` : "Empty";
    badge.className = cells ? "badge is-ok" : "badge is-warn";
  }

  function paintLoading() {
    loading.hidden = slots[active].ready || slots[active].failed;
  }

  function select(index) {
    active = index;
    frames.forEach((frame, i) => {
      if (!frame) return;
      frame.classList.toggle("is-inactive", i !== index);
    });
    tabs.forEach((tab, i) => {
      tab.setAttribute("aria-selected", i === index ? "true" : "false");
      tab.classList.toggle("is-on", i === index);
    });
    if (slots[index].failed && !slots[index].ready) showError(index);
    else errorPanel.hidden = true;
    paintLoading();
    fitFrame(index);
  }

  let fitting = false;
  function fitFrame(index) {
    const frame = frames[index];
    if (!frame || fitting || index !== active) return;
    fitting = true;
    const height = frame.clientHeight;
    if (height > 1) frame.style.height = `${height - 1}px`;
    requestAnimationFrame(() => {
      if (frames[index]) frames[index].style.height = "100%";
      requestAnimationFrame(() => { fitting = false; });
    });
  }

  function send(index, message) {
    const frame = frames[index];
    if (!frame?.contentWindow) return;
    frame.contentWindow.postMessage(JSON.stringify(message), opts.origin);
  }

  function showError(index) {
    const firstTime = !slots[index].failed;
    slots[index].failed = true;
    if (firstTime) opts.onUnavailable?.(`diagram ${index + 1}`);
    paintBadge(index);
    if (index !== active) return;
    paintLoading();
    errorPanel.hidden = false;
    errorPanel.replaceChildren(
      el("strong", {}, [`The diagram editor did not start (diagram ${index + 1}).`]),
      el("p", {}, ["Check the network, then retry. Call the invigilator if this keeps happening."]),
      el("button", { type: "button", class: "primary", onclick: () => retry(index) }, ["Retry"]),
    );
  }

  function retry(index) {
    slots[index].failed = false;
    errorPanel.hidden = true;
    mountFrame(index);
    paintBadge(index);
    paintLoading();
  }

  function mountFrame(index) {
    clearTimeout(slots[index].timer);
    frames[index]?.remove();
    const iframe = document.createElement("iframe");
    iframe.className = index === active ? "diagram-frame" : "diagram-frame is-inactive";
    iframe.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-modals");
    iframe.referrerPolicy = "no-referrer";
    iframe.title = `Diagram ${index + 1}`;
    stage.append(iframe);
    frames[index] = iframe;
    slots[index].ready = false;
    slots[index].timer = setTimeout(() => {
      if (!slots[index].ready) showError(index);
    }, 90000);
    iframe.src = drawioUrl(opts.origin);
  }

  function onMessage(event) {
    if (event.origin !== opts.origin) return;
    const index = frames.findIndex((frame) => frame?.contentWindow === event.source);
    if (index < 0) return;
    const data = parseMessage(event.data);
    if (!data) return;
    if (data.event === "configure") {
      send(index, {
        action: "configure",
        config: {
          // Saved embed settings can close the shape list or replace this library list.
          override: true,
          defaultLibraries: "exam-uml;general;uml",
          enabledLibraries: ["general", "uml", "exam-uml"],
          libraries: [EXAM_UML],
          enableCustomLibraries: false,
          appendCustomLibraries: false,
          hideMenuItems: ["plugins"],
          suppressNewWindows: true,
          // draw.io closes the shape list when screen.width is 1024 or less.
          // A closed list leaves a blank canvas, so force it open.
          sidebarWidth: 232,
        },
      });
      return;
    }
    if (data.event === "init") {
      slots[index].ready = true;
      slots[index].failed = false;
      clearTimeout(slots[index].timer);
      if (index === active) errorPanel.hidden = true;
      send(index, { action: "load", xml: xmls[index] || EMPTY_XML, autosave: 1 });
      paintBadge(index);
      paintLoading();
      fitFrame(index);
      return;
    }
    if ((data.event === "autosave" || data.event === "save") && typeof data.xml === "string") {
      xmls[index] = data.xml;
      paintBadge(index);
      opts.onDirty?.();
      return;
    }
    if (data.event === "export" && slots[index].exportWait) {
      const wait = slots[index].exportWait;
      slots[index].exportWait = null;
      clearTimeout(wait.timer);
      const png = typeof data.data === "string" ? data.data : null;
      const xml = typeof data.xml === "string" && data.xml ? data.xml : (xmls[index] || "");
      if (xml) xmls[index] = xml;
      wait.resolve({ png, xml, pngError: png ? null : "export-empty" });
    }
  }

  window.addEventListener("message", onMessage);
  const onResize = () => fitFrame(active);
  window.addEventListener("resize", onResize);
  const observer = new ResizeObserver(() => fitFrame(active));
  observer.observe(stage);
  mountFrame(0);
  mountFrame(1);
  select(0);

  function exportOne(index) {
    return new Promise((resolve) => {
      if (!slots[index].ready || !frames[index]?.contentWindow) {
        resolve({ png: null, xml: xmls[index] || "", pngError: "editor-not-ready" });
        return;
      }
      const timer = setTimeout(() => {
        slots[index].exportWait = null;
        resolve({ png: null, xml: xmls[index] || "", pngError: "export-timeout" });
      }, 8000);
      slots[index].exportWait = { timer, resolve };
      send(index, {
        action: "export",
        format: "png",
        background: "#ffffff",
        border: 10,
      });
    });
  }

  return {
    getXml() {
      return xmls.slice();
    },
    exportAll() {
      return Promise.all([exportOne(0), exportOne(1)]);
    },
    relayout() {
      fitFrame(active);
    },
    destroy() {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("resize", onResize);
      observer.disconnect();
      slots.forEach((slot) => clearTimeout(slot.timer));
      frames.forEach((frame) => frame?.remove());
    },
  };
}
