#!/usr/bin/env node
import fs from 'node:fs/promises';

const manifest = JSON.parse(await fs.readFile(new URL('./chameleon-twenty-manifest.json', import.meta.url), 'utf8'));
const base = String(process.env.TWENTY_BASE_URL || '').replace(/\/$/, '');
const key = process.env.TWENTY_API_KEY;
if (!base || !key) throw new Error('TWENTY_BASE_URL and TWENTY_API_KEY are required');
const headers = {authorization: `Bearer ${key}`, 'content-type': 'application/json'};
async function rest(path, options = {}) { const r = await fetch(`${base}${path}`, {headers, ...options}); if (!r.ok) throw new Error(`${options.method || 'GET'} ${path} ${r.status}`); return r.json(); }
async function gql(query, variables) { const r = await fetch(`${base}/metadata`, {method: 'POST', headers, body: JSON.stringify({query, variables})}); const body = await r.json(); if (!r.ok || body.errors?.length) throw new Error(JSON.stringify(body.errors || body)); return body.data; }
let objects = (await rest('/rest/metadata/objects')).data;
let byName = new Map(objects.map(item => [item.nameSingular, item]));
async function allFields() {
  const result = []; let cursor = null;
  for (let page = 0; page < 20; page += 1) {
    const suffix = cursor ? `&starting_after=${encodeURIComponent(cursor)}` : '';
    const body = await rest(`/rest/metadata/fields?limit=200${suffix}`);
    result.push(...(body.data || []));
    if (!body.pageInfo?.hasNextPage) break;
    cursor = body.pageInfo.endCursor;
  }
  return result;
}
const report = {image: manifest.twentyImage, createdObjects: [], existingObjects: [], createdFields: [], existingFields: [], createdRelations: [], existingRelations: [], views: [], recordPages: [], dashboard: null};
for (const [objectName, spec] of Object.entries(manifest.objects)) {
  if (byName.has(objectName)) { report.existingObjects.push(objectName); continue; }
  await gql('mutation($input:CreateOneObjectInput!){createOneObject(input:$input){id nameSingular namePlural labelSingular labelPlural}}', {input: {object: {
    nameSingular: objectName,
    namePlural: spec.namePlural || `${objectName}s`,
    labelSingular: spec.labelSingular || objectName[0].toUpperCase() + objectName.slice(1),
    labelPlural: spec.labelPlural || (spec.namePlural || `${objectName}s`)[0].toUpperCase() + (spec.namePlural || `${objectName}s`).slice(1),
    description: spec.description || `Chameleon LAB ${objectName} projection`,
    icon: spec.icon || 'IconBox'
  }}});
  report.createdObjects.push(objectName);
  objects = (await rest('/rest/metadata/objects')).data;
  byName = new Map(objects.map(item => [item.nameSingular, item]));
}
let metadataFields = await allFields();
const fieldMap = () => new Map(metadataFields.map(field => [`${field.objectMetadataId}:${field.name}`, field]));
for (const [objectName, spec] of Object.entries(manifest.objects)) {
  const object = byName.get(objectName); if (!object) throw new Error(`required object missing after bootstrap: ${objectName}`);
  const fields = fieldMap();
  for (const field of [...(spec.requiredFieldsSpec || []), ...(spec.fields || [])]) {
    if (fields.has(`${object.id}:${field.name}`)) { report.existingFields.push(`${objectName}.${field.name}`); continue; }
    const data = await gql('mutation($input:CreateOneFieldMetadataInput!){createOneField(input:$input){id name type}}', {input: {field: {...field, objectMetadataId: object.id, isNullable: true, isUIEditable: true, isUIReadOnly: false}}});
    report.createdFields.push(`${objectName}.${data.createOneField.name}`);
    metadataFields.push({id: data.createOneField.id, name: data.createOneField.name, objectMetadataId: object.id});
  }
}
const freshObjects = (await rest('/rest/metadata/objects')).data;
const freshByName = new Map(freshObjects.map(item => [item.nameSingular, item]));
for (const relation of manifest.relations || []) {
  const object = freshByName.get(relation.object); const target = freshByName.get(relation.target);
  if (!object || !target) throw new Error(`relation object missing: ${relation.object} -> ${relation.target}`);
  if (!fieldMap().has(`${object.id}:${relation.name}`)) {
    const data = await gql('mutation($input:CreateOneFieldMetadataInput!){createOneField(input:$input){id name type}}', {input: {field: {type: 'RELATION', name: relation.name, label: relation.label || relation.target[0].toUpperCase() + relation.target.slice(1), icon: relation.icon || 'IconLink', objectMetadataId: object.id, isNullable: true, relationCreationPayload: {type: relation.type || 'MANY_TO_ONE', targetObjectMetadataId: target.id, targetFieldLabel: relation.inverseLabel || `${relation.object[0].toUpperCase()}${relation.object.slice(1)}s`, targetFieldIcon: 'IconList'}}}});
    report.createdRelations.push(`${relation.object}.${data.createOneField.name}`);
    metadataFields.push({id: data.createOneField.id, name: data.createOneField.name, objectMetadataId: object.id});
  } else report.existingRelations.push(`${relation.object}.${relation.name}`);
}
async function configureViewFields(view, object, names, widths = {}) {
  if (!names?.length) return view;
  const latest = await rest(`/rest/metadata/views/${view.id}`);
  const existing = new Map((latest.viewFields || []).map(field => [field.fieldMetadataId, field]));
  const fieldsByName = new Map((object.fields || []).map(field => [field.name, field]));
  const desired = new Set(names);
  for (const [name, field] of fieldsByName) {
    const update = {isVisible: desired.has(name), position: names.indexOf(name) >= 0 ? names.indexOf(name) : 999, size: desired.has(name) ? (widths[name] || 180) : 120};
    const current = existing.get(field.id);
    if (current) await gql('mutation($input:UpdateViewFieldInput!){updateViewField(input:$input){id}}', {input: {id: current.id, update}});
    else await gql('mutation($input:CreateViewFieldInput!){createViewField(input:$input){id}}', {input: {...update, fieldMetadataId: field.id, viewId: view.id}});
  }
}

async function configureViewQuery(view, object, viewSpec) {
  const desiredFilters = viewSpec.filters || [];
  if (desiredFilters.length) {
    const current = (await gql('query($viewId:String){getViewFilters(viewId:$viewId){id fieldMetadataId operand value viewFilterGroupId}}', {viewId: view.id})).getViewFilters;
    let groupId = current[0]?.viewFilterGroupId;
    if (!groupId) {
      const group = (await gql('mutation($input:CreateViewFilterGroupInput!){createViewFilterGroup(input:$input){id}}', {input: {viewId: view.id, logicalOperator: 'AND', positionInViewFilterGroup: 0}})).createViewFilterGroup;
      groupId = group.id;
    }
    for (const filterSpec of desiredFilters) {
      const field = (object.fields || []).find(item => item.name === filterSpec.field);
      if (!field) throw new Error(`view filter field missing: ${viewSpec.object}.${filterSpec.field}`);
      const exists = current.find(filter => filter.fieldMetadataId === field.id && filter.operand === filterSpec.operand && String(filter.value ?? '') === String(filterSpec.value ?? ''));
      if (!exists) await gql('mutation($input:CreateViewFilterInput!){createViewFilter(input:$input){id}}', {input: {viewId: view.id, viewFilterGroupId: groupId, fieldMetadataId: field.id, operand: filterSpec.operand, value: filterSpec.value ?? '', positionInViewFilterGroup: current.length}});
    }
  }
  if (viewSpec.sorts?.length) {
    const current = (await gql('query($viewId:String){getViewSorts(viewId:$viewId){id fieldMetadataId direction}}', {viewId: view.id})).getViewSorts;
    for (const sortSpec of viewSpec.sorts) {
      const field = (object.fields || []).find(item => item.name === sortSpec.field);
      if (!field) throw new Error(`view sort field missing: ${viewSpec.object}.${sortSpec.field}`);
      const exists = current.find(sort => sort.fieldMetadataId === field.id && sort.direction === sortSpec.direction);
      if (!exists) await gql('mutation($input:CreateViewSortInput!){createViewSort(input:$input){id}}', {input: {viewId: view.id, fieldMetadataId: field.id, direction: sortSpec.direction || 'ASC'}});
    }
  }
}

let views = (await rest('/rest/metadata/views')).data;
const statusField = fieldMap().get(`${freshByName.get('case').id}:status`);
const viewByName = new Map();
for (const viewSpec of manifest.views || []) {
  const object = freshByName.get(viewSpec.object);
  if (!object) throw new Error(`view object missing: ${viewSpec.object}`);
  let view = views.find(item => item.name === viewSpec.name && item.objectMetadataId === object.id);
  if (!view) view = (await gql('mutation($input:CreateViewInput!){createView(input:$input){id name type objectMetadataId}}', {input: {name: viewSpec.name, objectMetadataId: object.id, type: viewSpec.type || 'TABLE', icon: viewSpec.icon || 'IconListCheck', visibility: viewSpec.visibility || 'WORKSPACE', openRecordIn: viewSpec.openRecordIn || 'RECORD_PAGE'}})).createView;
  await gql('mutation($id:String!,$input:UpdateViewInput!){updateView(id:$id,input:$input){id}}', {id: view.id, input: {openRecordIn: viewSpec.openRecordIn || 'RECORD_PAGE', type: viewSpec.type || 'TABLE', visibility: viewSpec.visibility || 'WORKSPACE'}});
  if (viewSpec.statusFilter) {
    if (!statusField) throw new Error('case status field missing');
    const current = (await gql('query($viewId:String){getViewFilters(viewId:$viewId){id fieldMetadataId operand value viewFilterGroupId}}', {viewId: view.id})).getViewFilters;
    const operand = viewSpec.statusFilter === 'WAITING_APPROVAL' ? 'CONTAINS' : 'DOES_NOT_CONTAIN';
    const filterValue = 'WAITING_APPROVAL';
    const matching = current.find(filter => filter.fieldMetadataId === statusField.id);
    if (!matching) {
      const group = (await gql('mutation($input:CreateViewFilterGroupInput!){createViewFilterGroup(input:$input){id}}', {input: {viewId: view.id, logicalOperator: 'AND', positionInViewFilterGroup: 0}})).createViewFilterGroup;
      await gql('mutation($input:CreateViewFilterInput!){createViewFilter(input:$input){id}}', {input: {viewId: view.id, viewFilterGroupId: group.id, fieldMetadataId: statusField.id, operand, value: filterValue, positionInViewFilterGroup: 0}});
    } else if (matching.operand !== operand || matching.value !== filterValue) {
      await gql('mutation($input:UpdateViewFilterInput!){updateViewFilter(input:$input){id}}', {input: {id: matching.id, update: {operand, value: filterValue, fieldMetadataId: statusField.id}}});
    }
  }
  await configureViewFields(view, object, viewSpec.fields, viewSpec.fieldWidths);
  await configureViewQuery(view, object, viewSpec);
  viewByName.set(viewSpec.name, view);
  report.views.push({name: view.name, id: view.id, object: viewSpec.object, statusFilter: viewSpec.statusFilter || null, fields: viewSpec.fields || []});
}
const dashboardsResponse = await rest('/rest/dashboards?limit=100');
const dashboards = dashboardsResponse.data?.dashboards || [];
let dashboard = dashboards.find(item => item.title === manifest.dashboard?.name);
if (!dashboard && manifest.dashboard?.name) {
  dashboard = (await rest('/rest/dashboards', {method: 'POST', body: JSON.stringify({title: manifest.dashboard.name, position: -1})})).data?.createDashboard;
  report.dashboard = {name: dashboard?.title, id: dashboard?.id, created: true, pageLayoutId: dashboard?.pageLayoutId};
} else if (dashboard) report.dashboard = {name: dashboard.title, id: dashboard.id, created: false, pageLayoutId: dashboard.pageLayoutId};
if (manifest.dashboard?.name && !dashboard) throw new Error('dashboard bootstrap failed');
const frontComponents = (await gql('{frontComponents{id name universalIdentifier}}')).frontComponents;

async function ensurePageLayoutWidget(tab, widgetSpec, objectByName, viewByName, reportTarget) {
  let widget = (tab.widgets || []).find(item => item.type === widgetSpec.type && (item.title === widgetSpec.existingTitle || item.title === widgetSpec.title));
  const object = widgetSpec.object ? objectByName.get(widgetSpec.object) : null;
  const view = widgetSpec.view ? viewByName.get(widgetSpec.view) : null;
  const frontComponent = widgetSpec.frontComponentUniversalIdentifier
    ? frontComponents.find(item => item.universalIdentifier === widgetSpec.frontComponentUniversalIdentifier)
    : null;
  if (widgetSpec.frontComponentUniversalIdentifier && !frontComponent) {
    throw new Error('front component missing: ' + widgetSpec.frontComponentUniversalIdentifier);
  }
  const configuration = widgetSpec.type === 'FRONT_COMPONENT'
    ? {configurationType: 'FRONT_COMPONENT', frontComponentId: frontComponent.id}
    : JSON.parse(JSON.stringify(widgetSpec.configuration || {configurationType: widgetSpec.type}));
  if (view) configuration.viewId = view.id;
  if (widgetSpec.recordLimit) configuration.recordLimit = widgetSpec.recordLimit;
  if (configuration.aggregateField) {
    const aggregateField = (object?.fields || []).find(item => item.name === configuration.aggregateField);
    if (!aggregateField) throw new Error(`widget aggregate field missing: ${widgetSpec.object}.${configuration.aggregateField}`);
    configuration.aggregateFieldMetadataId = aggregateField.id;
    delete configuration.aggregateField;
  }
  if (configuration.filter?.recordFilters) {
    configuration.filter.recordFilters = configuration.filter.recordFilters.map(filter => {
      const {field, fieldName, ...rest} = filter;
      const filterField = (object?.fields || []).find(item => item.name === (fieldName || field));
      if (!filterField) throw new Error(`widget filter field missing: ${widgetSpec.object}.${fieldName || field}`);
      return {...rest, fieldMetadataId: filterField.id};
    });
  }
  const payload = {pageLayoutTabId: tab.id, title: widgetSpec.title, type: widgetSpec.type, ...(object ? {objectMetadataId: object.id} : {}), position: widgetSpec.position || null, configuration};
  if (widget) {
    await gql('mutation($id:String!,$input:UpdatePageLayoutWidgetInput!){updatePageLayoutWidget(id:$id,input:$input){id title type}}', {id: widget.id, input: {...payload, pageLayoutTabId: tab.id}});
    reportTarget.push({title: widgetSpec.title, id: widget.id, created: false});
  } else {
    widget = (await gql('mutation($input:CreatePageLayoutWidgetInput!){createPageLayoutWidget(input:$input){id title type}}', {input: payload})).createPageLayoutWidget;
    reportTarget.push({title: widgetSpec.title, id: widget.id, created: true});
  }
}

async function ensureDashboardLayout() {
  if (!dashboard || !manifest.dashboard?.tabs) return;
  const layout = (await gql('query($id:String!){getPageLayout(id:$id){id name type tabs{id title position layoutMode widgets{id title type objectMetadataId}}}}', {id: dashboard.pageLayoutId})).getPageLayout;
  const tabReport = [];
  for (const tabSpec of manifest.dashboard.tabs) {
    let tab = layout.tabs.find(item => item.title === tabSpec.title || item.title === tabSpec.existingTitle);
    if (tab) {
      await gql('mutation($id:String!,$input:UpdatePageLayoutTabInput!){updatePageLayoutTab(id:$id,input:$input){id title position layoutMode}}', {id: tab.id, input: {title: tabSpec.title, position: tabSpec.position, layoutMode: tabSpec.layoutMode || 'GRID'}});
      tab = {...tab, title: tabSpec.title, position: tabSpec.position, layoutMode: tabSpec.layoutMode || 'GRID'};
    } else {
      tab = (await gql('mutation($input:CreatePageLayoutTabInput!){createPageLayoutTab(input:$input){id title position layoutMode widgets{id title type objectMetadataId}}}', {input: {title: tabSpec.title, position: tabSpec.position, pageLayoutId: dashboard.pageLayoutId, layoutMode: tabSpec.layoutMode || 'GRID'}})).createPageLayoutTab;
    }
    const widgetReport = [];
    for (const widgetSpec of tabSpec.widgets || []) {
      const matches = (tab.widgets || []).filter(item => item.type === widgetSpec.type && (item.title === widgetSpec.existingTitle || item.title === widgetSpec.title));
      for (const duplicate of matches.slice(1)) {
        await gql('mutation($id:String!){destroyPageLayoutWidget(id:$id)}', {id: duplicate.id});
      }
      await ensurePageLayoutWidget({...tab, widgets: matches.slice(0, 1)}, widgetSpec, freshByName, viewByName, widgetReport);
    }
    tabReport.push({title: tab.title, id: tab.id, widgets: widgetReport});
  }
  report.dashboard = {...report.dashboard, tabs: tabReport};
}

async function ensureCaseRecordPage() {
  const spec = manifest.recordPages?.case;
  if (!spec) return;
  const object = freshByName.get('case');
  const layouts = (await gql('query($objectMetadataId:String,$pageLayoutType:PageLayoutType){getPageLayouts(objectMetadataId:$objectMetadataId,pageLayoutType:$pageLayoutType){id name type objectMetadataId tabs{id title position layoutMode widgets{id title type configuration{__typename ... on FieldsConfiguration{configurationType viewId}}}}}}', {objectMetadataId: object.id, pageLayoutType: 'RECORD_PAGE'})).getPageLayouts;
  let layout = layouts[0];
  if (!layout) layout = (await gql('mutation($input:CreatePageLayoutInput!){createPageLayout(input:$input){id name type objectMetadataId tabs{id title position layoutMode widgets{id title type}}}}', {input: {name: spec.name, type: 'RECORD_PAGE', objectMetadataId: object.id}})).createPageLayout;
  else if (layout.name !== spec.name) {
    layout = (await gql('mutation($id:String!,$input:UpdatePageLayoutInput!){updatePageLayout(id:$id,input:$input){id name type objectMetadataId}}', {id: layout.id, input: {name: spec.name}})).updatePageLayout;
    layout = {...layout, tabs: layouts[0].tabs};
  }
  const pageReport = {name: layout.name, id: layout.id, tabs: []};
  for (const tabSpec of spec.tabs || []) {
    let tab = layout.tabs.find(item => item.title === tabSpec.existingTitle || item.title === tabSpec.title);
    if (!tab) tab = (await gql('mutation($input:CreatePageLayoutTabInput!){createPageLayoutTab(input:$input){id title position layoutMode widgets{id title type configuration{__typename ... on FieldsConfiguration{configurationType viewId}}}}}', {input: {title: tabSpec.title, position: tabSpec.position, pageLayoutId: layout.id, layoutMode: tabSpec.layoutMode || 'VERTICAL_LIST'}})).createPageLayoutTab;
    else if (tab.title !== tabSpec.title) await gql('mutation($id:String!,$input:UpdatePageLayoutTabInput!){updatePageLayoutTab(id:$id,input:$input){id title}}', {id: tab.id, input: {title: tabSpec.title, position: tabSpec.position, layoutMode: tabSpec.layoutMode || 'VERTICAL_LIST'}});
    const fieldSpec = tabSpec.fieldsWidget;
    if (fieldSpec) {
      let widget = (tab.widgets || []).find(item => item.title === fieldSpec.existingTitle || item.title === fieldSpec.title);
      let fieldsView = null;
      if (widget?.configuration?.viewId) fieldsView = {id: widget.configuration.viewId};
      if (!fieldsView) {
        const allViews = (await rest('/rest/metadata/views')).data;
        const fieldsViewName = fieldSpec.viewName || `${spec.name} Fields`;
        fieldsView = allViews.find(item => item.name === fieldsViewName && item.objectMetadataId === object.id);
        if (!fieldsView) fieldsView = (await gql('mutation($input:CreateViewInput!){createView(input:$input){id name type objectMetadataId}}', {input: {name: fieldsViewName, objectMetadataId: object.id, type: 'FIELDS_WIDGET', icon: 'IconList', visibility: 'WORKSPACE'}})).createView;
      }
      await configureViewFields(fieldsView, object, fieldSpec.fields);
      if (widget) await gql('mutation($id:String!,$input:UpdatePageLayoutWidgetInput!){updatePageLayoutWidget(id:$id,input:$input){id title type}}', {id: widget.id, input: {title: fieldSpec.title, pageLayoutTabId: tab.id, type: 'FIELDS', objectMetadataId: object.id}});
      else {
        widget = (await gql('mutation($input:CreatePageLayoutWidgetInput!){createPageLayoutWidget(input:$input){id title type configuration{__typename ... on FieldsConfiguration{configurationType viewId}}}}', {input: {pageLayoutTabId: tab.id, title: fieldSpec.title, type: 'FIELDS', objectMetadataId: object.id, position: null, configuration: {configurationType: 'FIELDS', viewId: fieldsView.id}}})).createPageLayoutWidget;
      }
    }
    const frontSpec = tabSpec.frontComponentWidget;
    if (frontSpec) {
      const frontComponent = frontComponents.find(item => item.universalIdentifier === frontSpec.frontComponentUniversalIdentifier);
      if (!frontComponent) throw new Error(`front component missing: ${frontSpec.frontComponentUniversalIdentifier}`);
      let widget = (tab.widgets || []).find(item => item.title === frontSpec.title);
      const input = {pageLayoutTabId: tab.id, title: frontSpec.title, type: 'FRONT_COMPONENT', objectMetadataId: object.id, position: null, configuration: {configurationType: 'FRONT_COMPONENT', frontComponentId: frontComponent.id}};
      if (widget) await gql('mutation($id:String!,$input:UpdatePageLayoutWidgetInput!){updatePageLayoutWidget(id:$id,input:$input){id title type}}', {id: widget.id, input});
      else widget = (await gql('mutation($input:CreatePageLayoutWidgetInput!){createPageLayoutWidget(input:$input){id title type}}', {input})).createPageLayoutWidget;
      pageReport.tabs.push({title: tabSpec.title, id: tab.id, frontComponent: {title: widget.title, id: widget.id, frontComponentId: frontComponent.id}, fields: fieldSpec?.fields || []});
    } else {
      pageReport.tabs.push({title: tabSpec.title, id: tab.id, fields: fieldSpec?.fields || []});
    }
  }
  report.recordPages.push(pageReport);
}

await ensureDashboardLayout();
await ensureCaseRecordPage();
console.log(JSON.stringify(report));
